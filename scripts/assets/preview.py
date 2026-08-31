"""
Render a contact sheet of the converted `.glb` props for visual review.

    blender -b --python scripts/assets/preview.py -- --dir public/models/meeting-room --out preview.png

Assets are laid out in a row at true relative scale beside a 1m reference cube
and viewed from glTF +Z, so orientation, scale and shading can all be checked
in one image.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# The rug is two orders of magnitude wider than a mug, so it gets its own
# shot rather than dragging the framing of everything else with it.
GROUPS = {
    "props": ["office-chair", "plant", "notebook", "mug"],
    "tabletop": ["notebook", "mug"],
    "rug": ["rug-round"],
    "floorstanding": ["bookshelf", "file-cabinet", "cardboard-boxes", "printer"],
    "desktop": ["phone", "pens", "soda-can", "mug", "notebook"],
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def setup_world():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 620
    scene.render.film_transparent = False

    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.72, 0.70, 0.66, 1.0)
    bg.inputs["Strength"].default_value = 1.1
    scene.world = world

    ground = bpy.data.meshes.new("ground")
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    mat = bpy.data.materials.new("ground")
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        [srgb_to_linear(0.91)] * 3 + [1.0]
    )
    bpy.context.active_object.data.materials.append(mat)

    light = bpy.data.lights.new("key", type="SUN")
    light.energy = 3.2
    light.angle = math.radians(12)
    obj = bpy.data.objects.new("key", light)
    obj.rotation_euler = (math.radians(52), 0, math.radians(38))
    bpy.context.collection.objects.link(obj)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in set(bpy.data.objects) - before if o.type == "MESH"]
    # Same reason as in the converter: the importer's axis conversion rides on
    # the object, so bake it before measuring anything.
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()
    return meshes


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--group", default="props", choices=sorted(GROUPS))
    args = parser.parse_args(argv)

    setup_world()

    # A 1m cube anchors the eye: anything that reads wrong against it is wrong.
    ref_size = 0.1 if args.group in ("tabletop", "desktop") else 1.0
    bpy.ops.mesh.primitive_cube_add(size=ref_size, location=(0, 0, ref_size / 2))
    ref = bpy.context.active_object
    ref_mat = bpy.data.materials.new("ref")
    ref_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        [srgb_to_linear(0.42)] * 3 + [1.0]
    )
    ref.data.materials.append(ref_mat)

    laid = [ref]
    x = 0.5
    for name in GROUPS[args.group]:
        path = os.path.join(args.dir, "%s.glb" % name)
        if not os.path.exists(path):
            continue
        meshes = load(path)
        width = max((m.dimensions.x for m in meshes), default=1.0)
        # glTF import lands the model Z-up again, so Z is still height here.
        x += width / 2 + 0.6
        for mesh in meshes:
            mesh.location.x += x
        laid.extend(meshes)
        print("LAID %-13s at x=%.2f dim=(%.3f, %.3f, %.3f)"
              % (name, x, meshes[0].dimensions.x, meshes[0].dimensions.y, meshes[0].dimensions.z))
        x += width / 2

    # Frame whatever was actually laid out, so one script serves a 9m rug and
    # a 98mm mug without hand-tuned camera numbers per group.
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for obj in laid for c in obj.bound_box]
    min_x = min(c.x for c in corners)
    max_x = max(c.x for c in corners)
    max_z = max(c.z for c in corners)
    span = max(max_x - min_x, 1.0)
    mid_x = (min_x + max_x) / 2

    min_z = min(c.z for c in corners)
    target = Vector((mid_x, 0.0, (min_z + max_z) / 2))
    # Aim by look-at rather than a hand-derived pitch: the earlier version
    # tilted the camera without re-aiming it and framed empty floor.
    elevation = math.radians(24)
    distance = span * 1.5
    bpy.ops.object.camera_add()
    camera = bpy.context.active_object
    camera.data.lens = 50
    camera.location = target + Vector((
        0.0,
        -distance * math.cos(elevation),
        distance * math.sin(elevation),
    ))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera
    print("FRAME span=%.2f dist=%.2f cam=(%.2f, %.2f, %.2f) -> (%.2f, %.2f, %.2f)"
          % (span, distance, camera.location.x, camera.location.y, camera.location.z,
             target.x, target.y, target.z))

    bpy.context.scene.render.filepath = args.out
    bpy.ops.render.render(write_still=True)
    print("RENDERED %s" % args.out)


main()
