"""
Convert selected Ultimate Modular Men / Women characters into small, seated
`.glb` figures for the meeting room's chairs.

Run through Blender:

    blender -b --python scripts/assets/convert-people.py -- \
        --men "<men pack dir>" --women "<women pack dir>" --out public/models/people

The packs ship rigged A-pose characters (Quaternius `CharacterArmature`, 79
bones, flat-coloured materials, no textures). Each one here is scaled to a
common standing height, folded into a single seated pose by rotating a handful
of bones, and then baked to a static mesh — the skeleton and every animation
channel are dropped, so a seated participant costs one draw call and no
per-frame work. Unlike the props, a person keeps their own colours: a room of
palette-grey mannequins reads worse than one with people in it. Only genuinely
loud clothing (hi-vis orange, neon) is pulled back toward the room's muted end,
because those hues carry meaning here (lime = you/support, orange = conflict).

Sources stay outside the repository; the `.glb` files under
`public/models/people/` are the committed artefact.
"""

import argparse
import colorsys
import math
import os
import sys

import bpy
import mathutils

# Seat index -> (pack, path within pack). The meeting room assigns these round
# robin by seat, so the list only has to be varied and office-plausible.
PEOPLE = {
    "woman-suit": ("women", "Suit/Suit.fbx"),
    "man-suit": ("men", "Business Man/Suit.fbx"),
    "woman-casual": ("women", "Animated Woman/Casual.fbx"),
    "man-casual": ("men", "Casual Character/Casual_2.fbx"),
    "woman-formal": ("women", "Animated Woman-nIItLV9nxS/Formal.fbx"),
    "man-hoodie": ("men", "Hoodie Character/Casual_Hoodie.fbx"),
    "woman-worker": ("women", "Worker/Worker.fbx"),
    "man-worker": ("men", "Worker/Worker.fbx"),
}

# A standing character is normalised to this height (metres) before being
# seated, so a suit and a hoodie end up the same size in the chair.
STANDING_HEIGHT = 1.75

# The seated pose, in degrees, applied about world axes through each bone's
# head while the armature is in pose mode. Parents are posed before children so
# the rotations compound the way a real joint chain does. Folding the legs this
# far drops the folded length to about a standing hip height, so resting the
# baked feet on the floor also lands the hips at seat height with no separate
# translation.
POSE = {
    "lean": -7.0,         # slight forward lean at the waist
    "thigh": -74.0,       # hips -> thighs forward, roughly horizontal
    "shin": 74.0,         # knees -> shins back down toward the floor
    "foot": 18.0,         # tilt off the rest (flat, forward) so the toe lifts
    "upper_arm": 62.0,    # shoulders -> arms down at the sides
    "fore_arm": -24.0,    # elbows -> forearms in toward the table
}

# Materials that are identity, not clothing: never muted.
KEEP = {
    "skin", "eye", "eyes", "eyebrows", "hair", "hair_brown", "hair_blond",
    "brown", "black", "white", "grey", "gray", "tie", "teeth", "mouth",
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def mute(rgba):
    """Pull hi-vis and neon clothing back toward the room's muted range.

    Left alone, a worker's orange vest or a character's neon trousers land
    exactly on the two hues the room uses for meaning. Anything both saturated
    and bright is desaturated and capped; everything calmer passes through.
    """
    r, g, b, a = rgba
    h, s, v = colorsys.rgb_to_hsv(
        linear_to_srgb(r), linear_to_srgb(g), linear_to_srgb(b)
    )
    if s > 0.55 and v > 0.45:
        s *= 0.4
        v = min(v, 0.6)
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return [srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a]


def strip_colors(mesh):
    """Drop any vertex-colour layer.

    A few of the pack meshes ship a `Col` attribute that carries nothing
    useful; nothing here reads vertex colour, so it just goes rather than
    riding along into the glTF as a `COLOR_0` that three.js would multiply in.
    """
    colors = mesh.data.color_attributes
    while colors:
        colors.remove(colors[0])


def reshade(meshes):
    seen = set()
    for mesh in meshes:
        for slot in mesh.material_slots:
            mat = slot.material
            if mat is None or mat.name in seen:
                continue
            seen.add(mat.name)
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf is None:
                continue
            bsdf.inputs["Metallic"].default_value = 0.0
            bsdf.inputs["Roughness"].default_value = 0.72

            # The men's packs import with the Principled `Alpha` socket at 0 and
            # the material set to alpha-clip: glTF then writes alphaMode MASK
            # with a zero cutoff and three.js discards every fragment, so the
            # figure is invisible. Nothing here is meant to be see-through.
            alpha = bsdf.inputs.get("Alpha")
            if alpha is not None:
                for link in list(alpha.links):
                    mat.node_tree.links.remove(link)
                alpha.default_value = 1.0
            for attr, value in (
                ("blend_method", "OPAQUE"),
                ("shadow_method", "OPAQUE"),
                ("surface_render_method", "DITHERED"),
            ):
                try:
                    setattr(mat, attr, value)
                except (AttributeError, TypeError):
                    pass

            base = bsdf.inputs["Base Color"]
            token = mat.name.split(".")[0].strip().lower()
            if token not in KEEP:
                base.default_value = mute(list(base.default_value))


X_AXIS = mathutils.Vector((1.0, 0.0, 0.0))   # the character's left-right axis
UP_AXIS = mathutils.Vector((0.0, 0.0, 1.0))  # world up, for the arm swing


def rotate_bone(pose_bone, axis, degrees):
    """Rotate a posed bone about an armature-space axis through its own head."""
    if pose_bone is None or not degrees:
        return
    rotation = mathutils.Matrix.Rotation(math.radians(degrees), 4, axis)
    head = pose_bone.matrix.to_translation()
    to_head = mathutils.Matrix.Translation(head)
    pose_bone.matrix = to_head @ rotation @ to_head.inverted() @ pose_bone.matrix
    bpy.context.view_layer.update()


def seat(armature):
    """Fold the rig into a seated pose, in pose mode.

    The legs bend at the hip and knee; the feet are not children of the shin in
    this rig, so once the shins swing down each foot is carried to its new
    ankle and turned flat by hand. The hips are left at standing height — the
    room sits the baked figure by resting its feet on the floor, which drops
    the whole thing onto the seat.
    """
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode="POSE")

    bones = armature.pose.bones
    rotate_bone(bones.get("Abdomen"), X_AXIS, POSE["lean"])

    for side in (".L", ".R"):
        rotate_bone(bones.get("UpperLeg" + side), X_AXIS, POSE["thigh"])
        rotate_bone(bones.get("LowerLeg" + side), X_AXIS, POSE["shin"])
        sign = 1.0 if side == ".L" else -1.0
        rotate_bone(bones.get("UpperArm" + side), UP_AXIS, sign * POSE["upper_arm"])
        rotate_bone(bones.get("LowerArm" + side), X_AXIS, POSE["fore_arm"])

    for side in (".L", ".R"):
        ankle = bones.get("LowerLeg" + side + "_end") or bones.get("LowerLeg" + side)
        foot = bones.get("Foot" + side)
        if ankle is None or foot is None:
            continue
        rest_rotation = armature.data.bones["Foot" + side].matrix_local.to_3x3().to_4x4()
        foot.matrix = (
            mathutils.Matrix.Translation(ankle.matrix.to_translation())
            @ mathutils.Matrix.Rotation(math.radians(POSE["foot"]), 4, X_AXIS)
            @ rest_rotation
        )
        bpy.context.view_layer.update()

    bpy.ops.object.mode_set(mode="OBJECT")


def bake_pose(mesh, armature):
    """Write the current posed deformation into the mesh data by hand.

    Background Blender will not evaluate a pose through the armature modifier
    before `convert`/`modifier_apply` reads the mesh back, so the deformation
    is computed here directly: linear blend skinning from each vertex group's
    weight and its bone's pose-vs-rest transform.
    """
    bone_of = {i: group.name for i, group in enumerate(mesh.vertex_groups)}
    world = mesh.matrix_world.copy()
    to_local = world.inverted()
    arm_world = armature.matrix_world.copy()
    arm_local = arm_world.inverted()

    palette = {}
    for name in set(bone_of.values()):
        pose_bone = armature.pose.bones.get(name)
        rest_bone = armature.data.bones.get(name)
        if pose_bone and rest_bone:
            skin = pose_bone.matrix @ rest_bone.matrix_local.inverted()
            palette[name] = to_local @ arm_world @ skin @ arm_local @ world

    posed = []
    for vertex in mesh.data.vertices:
        blended = mathutils.Vector((0.0, 0.0, 0.0))
        total = 0.0
        for group in vertex.groups:
            transform = palette.get(bone_of.get(group.group))
            if transform is None or group.weight == 0.0:
                continue
            blended += (transform @ vertex.co) * group.weight
            total += group.weight
        posed.append(blended / total if total > 0.0 else vertex.co.copy())
    for vertex, co in zip(mesh.data.vertices, posed):
        vertex.co = co
    mesh.data.update()


def combined_height(meshes):
    lo = hi = None
    for mesh in meshes:
        for corner in mesh.bound_box:
            z = (mesh.matrix_world @ mathutils.Vector(corner)).z
            lo = z if lo is None else min(lo, z)
            hi = z if hi is None else max(hi, z)
    return (hi - lo) if lo is not None else 1.0


def set_origin_bottom_center(obj):
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    cx = (min(c.x for c in corners) + max(c.x for c in corners)) / 2
    cy = (min(c.y for c in corners) + max(c.y for c in corners)) / 2
    cz = min(c.z for c in corners)
    bpy.context.scene.cursor.location = mathutils.Vector((cx, cy, cz))
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj.location = (0.0, 0.0, 0.0)
    bpy.context.scene.cursor.location = mathutils.Vector((0.0, 0.0, 0.0))


def build(name, pack_path, out_dir):
    if not os.path.exists(pack_path):
        raise SystemExit("missing source: %s" % pack_path)

    reset()
    bpy.ops.import_scene.fbx(filepath=pack_path)
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]

    # Normalise standing height by scaling the rig, then bake the scale in.
    factor = STANDING_HEIGHT / combined_height(meshes)
    armature.scale = (factor, factor, factor)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.context.view_layer.update()

    seat(armature)
    reshade(meshes)

    # Bake the posed deformation into the mesh data, then drop the skeleton and
    # every animation channel with it.
    for mesh in meshes:
        for modifier in list(mesh.modifiers):
            if modifier.type == "ARMATURE":
                mesh.modifiers.remove(modifier)
        bake_pose(mesh, armature)
        strip_colors(mesh)
    bpy.data.objects.remove(armature, do_unlink=True)

    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    figure = bpy.context.view_layer.objects.active

    for poly in figure.data.polygons:
        poly.use_smooth = True
    modifier = figure.modifiers.new(name="smooth", type="WEIGHTED_NORMAL")
    modifier.keep_sharp = True
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))

    set_origin_bottom_center(figure)
    figure.name = name
    figure.data.name = name

    out_path = os.path.join(out_dir, "%s.glb" % name)
    bpy.ops.object.select_all(action="DESELECT")
    figure.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_image_format="NONE",
        export_yup=True,
    )

    figure.data.calc_loop_triangles()
    dims = figure.dimensions
    print(
        "BUILT %-13s tris=%-5d dim=(%.2f, %.2f, %.2f) scale=%.3f kb=%.1f"
        % (
            name,
            len(figure.data.loop_triangles),
            dims.x,
            dims.y,
            dims.z,
            factor,
            os.path.getsize(out_path) / 1024,
        )
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--men", required=True)
    parser.add_argument("--women", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", default=None)
    args = parser.parse_args(argv)

    packs = {"men": args.men, "women": args.women}
    os.makedirs(args.out, exist_ok=True)
    names = [args.only] if args.only else list(PEOPLE)
    for name in names:
        pack, rel = PEOPLE[name]
        build(name, os.path.join(packs[pack], rel), args.out)


main()
