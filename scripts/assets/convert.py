"""
Convert selected Office Pack source models into small, palette-matched `.glb`
assets for the meeting room.

Run through Blender:

    blender -b --python scripts/assets/convert.py -- --pack "<pack dir>" --out public/models/meeting-room

The pack models arrive as low-poly game props with saturated baked palettes.
Nothing from the pack ships as-is: each model is stripped of its original
materials and re-shaded from the room's own `SURFACE` palette, so the pack
contributes silhouette only. Sources stay outside the repository.
"""

import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

# Mirrors SURFACE in src/visualization/scene/meeting-room-layout.ts.
PALETTE = {
    "inlay": "#e3dfd5",
    "frame": "#2e2b27",
    "seat": "#d2cdc3",
    "seatDark": "#4a453e",
    "boardLight": "#f8f6f1",
    "card": "#e6e2d8",
    "quiet": "#c7c2b8",
    "foliage": "#8f9e6a",
    "foliageDark": "#6f7d51",
    "chairFabric": "#8d88a6",
    "wood": "#dcc5a4",
    "cardboard": "#c3a67e",
    "metal": "#c7c2b8",
}

ASSETS = {
    "bookshelf": {
        "src": "Medium Book Shelf/MediumBookShelf1.fbx",
        "materials": {
            "WoodMediumBookShelf1": ("wood", 0.7),
            "WoodDoorLeft1_MediumBookShelf1": ("wood", 0.7),
            "WoodDoorRight1_MediumBookShelf1": ("wood", 0.7),
            "MetalDoorLeft1_MediumBookShelf1": ("seatDark", 0.6),
            "MetalDoorRight1_MediumBookShelf1": ("seatDark", 0.6),
        },
        "fit": ("height", 2.0),
        "smooth": 30.0,
    },
    "cardboard-boxes": {
        "src": "Cardboard Boxes/CardboardBoxes_4.fbx",
        "materials": {"Cardboard": ("cardboard", 0.95), "Tape": ("quiet", 0.8)},
        "fit": ("height", 0.92),
        "smooth": None,
    },
    "file-cabinet": {
        "src": "File Cabinet/FileCabinet.fbx",
        "materials": {
            "Metal_1": ("metal", 0.55),
            "Metal_Handle": ("seatDark", 0.5),
            "Sticker": ("card", 0.9),
        },
        "fit": ("height", 1.25),
        "rotate": (0, -90),
        "smooth": 30.0,
    },
    "printer": {
        "src": "Printer/Printer.fbx",
        "materials": {"Material": ("seatDark", 0.6)},
        "fit": ("footprint", 0.46),
        "smooth": 30.0,
    },
    "soda-can": {
        "src": "Soda Can/Soda_Can_01.obj",
        # Neutral on purpose: the room's saturated tones all mean something
        # (lime = support/you, orange = conflict) and a drinks can means nothing.
        "materials": {
            "FFFFFF": ("boardLight", 0.4),
            "F44336": ("seatDark", 0.6),
            "78909C": ("quiet", 0.5),
        },
        "fit": ("height", 0.122),
        "smooth": 40.0,
    },
    "phone": {
        "src": "Phone/model.obj",
        "materials": {
            "mat5": ("frame", 0.5),
            "mat8": ("frame", 0.5),
            "mat15": ("frame", 0.5),
            "mat16": ("frame", 0.5),
            "mat17": ("seatDark", 0.4),
            "mat23": ("frame", 0.5),
            "mat24": ("frame", 0.5),
            "mat25": ("seatDark", 0.3),
        },
        # Ships standing on its edge at desk-phone size; laid flat and cut to
        # something a hand would actually pick up.
        "rotate": (90, 0),
        "fit": ("footprint", 0.15),
        "smooth": 30.0,
    },
    "pens": {
        "src": "Pens/Pens.obj",
        "materials": {
            "_crayfishdiffuse": ("seatDark", 0.6),
            "02___Default": ("frame", 0.6),
            "03___Default": ("quiet", 0.6),
            "07___Default": ("seatDark", 0.6),
            "08___Default": ("boardLight", 0.6),
            "09___Default": ("frame", 0.6),
        },
        "fit": ("footprint", 0.19),
        "smooth": 30.0,
    },
    "office-chair": {
        "src": "Office Chair/OfficeChair.fbx",
        # Blue seat shell, grey column, black castors. The shell takes the one
        # upholstery tone in the room: eight bone chairs on a bone rug in front
        # of bone walls disappeared into each other.
        "materials": {
            "Chair": ("chairFabric", 0.9),
            "Grey": ("seatDark", 0.8),
            "Black": ("frame", 0.7),
        },
        "fit": ("height", 1.12),
        "face": "auto",
        "smooth": 30.0,
    },
    "rug-round": {
        "src": "Rug Round/rugRound.obj",
        # Kenney ships it bright red; the room wants the floor inlay tone.
        "materials": {"carpet": ("inlay", 1.0), "carpetDarker": ("quiet", 1.0)},
        "fit": ("footprint", 9.2),
        # Kenney's disc is a 24-gon - fine as a 0.9m prop, visibly polygonal
        # blown up to 9.2m. One Catmull-Clark level lands it at 48 segments,
        # the same smoothness as the circleGeometry inlay it replaces.
        "subdivide": 1,
        # Scaling a rug up 10x would scale its pile to a 100mm kerb, so the
        # thickness is set in room units rather than carried by the fit.
        "flatten": 0.03,
        "smooth": None,
    },
    "plant": {
        "src": "Plant - White Pot/model.obj",
        "materials": {
            "mat21": ("boardLight", 0.9),
            "mat9": ("foliage", 0.85),
            "mat20": ("seatDark", 1.0),
        },
        "fit": ("height", 1.35),
        "smooth": 40.0,
    },
    "mug": {
        "src": "Mug/496 Mugs.obj",
        # A near-white mug on a bone table is invisible from every camera
        # pose in the room. Dark ceramic reads at any distance, and the room
        # already pairs bone with near-black everywhere else.
        "materials": {"Mat": ("seatDark", 0.6)},
        "fit": ("height", 0.098),
        "single_part": True,
        "smooth": 40.0,
    },
    "notebook": {
        "src": "Notebook/Notebook_01.obj",
        # Material-Design yellow/red/brown. Attention orange is reserved for
        # real conflict state, so nothing here borrows it.
        "materials": {"FFEB3B": ("card", 0.9), "F44336": ("quiet", 0.9), "795548": ("seatDark", 0.8)},
        "fit": ("footprint", 0.21),
        "smooth": 30.0,
    },
    "book-stack": {
        "src": "Book Stack/model.obj",
        # Ships as a cluster of hardbacks in ten saturated spine colours. The
        # room's saturated tones each carry a meaning (lime = you/support,
        # orange = conflict), so every spine is remapped onto the neutral end
        # of the palette: books read as books by silhouette, and a full shelf
        # never lights up like a workspace. Kept faceted — a low-poly book has
        # a hard spine, and smoothing only rounds it into a bar of soap.
        "materials": {
            "mat21": ("boardLight", 0.85),
            "mat1": ("seatDark", 0.85),
            "mat3": ("quiet", 0.85),
            "mat4": ("wood", 0.8),
            "mat5": ("seatDark", 0.85),
            "mat8": ("wood", 0.8),
            "mat10": ("quiet", 0.85),
            "mat16": ("seatDark", 0.85),
            "mat17": ("frame", 0.8),
            "mat23": ("frame", 0.8),
        },
        "fit": ("height", 0.2),
        "smooth": None,
    },
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(value):
    value = value.lstrip("#")
    rgb = [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [srgb_to_linear(c) for c in rgb] + [1.0]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_source(path):
    if os.path.splitext(path)[1].lower() == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o.type == "MESH"]


def bake_transform(obj):
    """Bake the importer's axis conversion into the mesh.

    The pack's Y-up OBJs are stood up by the importer as a 90 degree object
    rotation rather than in the vertex data, and `obj.dimensions` reports the
    unrotated local bounding box - so every measurement below (fit axis, rug
    thickness, backrest side) would otherwise be taken in the source's axes
    instead of the room's. Applying it first makes local and world agree.
    """
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.context.view_layer.update()


def join(meshes):
    bpy.ops.object.select_all(action="DESELECT")
    for mesh in meshes:
        mesh.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def keep_largest_part(obj):
    """Some pack files bundle several copies of a prop; keep one."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.mesh.separate(type="LOOSE")
    parts = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    if len(parts) < 2:
        return obj, 1
    keep = max(parts, key=lambda o: len(o.data.vertices))
    for part in parts:
        if part is not keep:
            bpy.data.objects.remove(part, do_unlink=True)
    bpy.context.view_layer.objects.active = keep
    return keep, len(parts)


def reshade(obj, mapping):
    """Replace every source material with a flat one from the room palette."""
    unmapped = []
    for slot in obj.material_slots:
        source = slot.material
        if source is None:
            continue
        entry = mapping.get(source.name)
        if entry is None:
            unmapped.append(source.name)
            entry = ("quiet", 0.9)
        token, roughness = entry
        mat = bpy.data.materials.new(name="room-%s" % token)
        bsdf = mat.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = hex_to_linear(PALETTE[token])
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = 0.0
        slot.material = mat
    return unmapped


def front_offset(obj):
    """Which way the backrest leans, so a chair can be turned to face the table."""
    zs = [v.co.z for v in obj.data.vertices]
    low, high = min(zs), max(zs)
    cut = low + (high - low) * 0.62
    upper = [v.co for v in obj.data.vertices if v.co.z >= cut]
    if not upper:
        return 0.0
    mean_upper = sum((v.y for v in upper)) / len(upper)
    mean_all = sum((v.co.y for v in obj.data.vertices)) / len(obj.data.vertices)
    return mean_upper - mean_all


def pre_rotate(obj, degrees):
    """Stand a model the way the room needs it, before anything is measured.

    Two pack models arrive in their authoring pose rather than their resting
    one: the phone stands on its edge, and the filing cabinet's drawers face
    along +X where every other prop here fronts onto +Z. Applying the turn up
    front means the fit axis, the origin and the exported orientation are all
    taken in the pose the room will actually see.
    """
    around_x, around_z = degrees
    if not around_x and not around_z:
        return
    obj.rotation_euler[0] += math.radians(around_x)
    obj.rotation_euler[2] += math.radians(around_z)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bpy.context.view_layer.update()


def orient(obj, face):
    """Rotate so the model's front points to Blender -Y (glTF +Z)."""
    if face != "auto":
        return 0.0
    offset = front_offset(obj)
    # Backrest mass sits behind the seat; front is the opposite side.
    turn = math.pi if offset < 0 else 0.0
    if turn:
        obj.rotation_euler[2] += turn
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return turn


def crease_material_seams(obj):
    """Pin the borders between colour regions before subdividing.

    Left uncreased, Catmull-Clark drags the seam between the rug field and its
    border into a visibly lumpy ring. Creasing only the seams keeps each colour
    region's outline regular while the outer silhouette still rounds off.
    """
    mesh = obj.data
    edge_index = {tuple(sorted(edge.vertices)): i for i, edge in enumerate(mesh.edges)}
    seen = {}
    seams = set()
    for polygon in mesh.polygons:
        for key in polygon.edge_keys:
            key = tuple(sorted(key))
            previous = seen.get(key)
            if previous is None:
                seen[key] = polygon.material_index
            elif previous != polygon.material_index:
                seams.add(key)

    if not seams:
        return 0
    attribute = mesh.attributes.get("crease_edge") or mesh.attributes.new(
        "crease_edge", "FLOAT", "EDGE"
    )
    for key in seams:
        attribute.data[edge_index[key]].value = 1.0
    return len(seams)


def subdivide(obj, levels):
    if not levels:
        return
    # Catmull-Clark over the pack's triangle fan pulls the material seam into a
    # ragged inner ring, so the disc is quadrangulated first.
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.tris_convert_to_quads(face_threshold=3.14159, shape_threshold=3.14159)
    bpy.ops.object.mode_set(mode="OBJECT")
    crease_material_seams(obj)
    modifier = obj.modifiers.new(name="subdivide", type="SUBSURF")
    modifier.levels = levels
    modifier.render_levels = levels
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.update()


def fit(obj, axis, target, flatten=None):
    dims = obj.dimensions
    current = dims.z if axis == "height" else max(dims.x, dims.y)
    if current <= 0:
        return 1.0
    factor = target / current
    obj.scale = (factor, factor, factor)
    if flatten is not None and dims.z > 0:
        obj.scale[2] = flatten / dims.z
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return factor


def set_origin_bottom_center(obj):
    """Origin at the footprint centre on the ground plane, so placement is just x/z."""
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    centre_x = (min(c.x for c in corners) + max(c.x for c in corners)) / 2
    centre_y = (min(c.y for c in corners) + max(c.y for c in corners)) / 2
    bottom_z = min(c.z for c in corners)
    bpy.context.scene.cursor.location = Vector((centre_x, centre_y, bottom_z))
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    obj.location = (0.0, 0.0, 0.0)
    bpy.context.scene.cursor.location = Vector((0.0, 0.0, 0.0))


def smooth(obj, angle):
    for poly in obj.data.polygons:
        poly.use_smooth = angle is not None
    if angle is None:
        return
    modifier = obj.modifiers.new(name="smooth-by-angle", type="WEIGHTED_NORMAL")
    modifier.keep_sharp = True
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))


def build(name, spec, pack_dir, out_dir):
    path = os.path.join(pack_dir, spec["src"])
    if not os.path.exists(path):
        raise SystemExit("missing source: %s" % path)

    reset()
    meshes = import_source(path)
    obj = join(meshes)
    bake_transform(obj)
    parts = 1
    if spec.get("single_part"):
        obj, parts = keep_largest_part(obj)

    pre_rotate(obj, spec.get("rotate", (0, 0)))
    unmapped = reshade(obj, spec["materials"])
    turn = orient(obj, spec.get("face", "none"))
    # Subdivision shrinks the silhouette, so it runs before the fit.
    subdivide(obj, spec.get("subdivide"))
    axis, target = spec["fit"]
    factor = fit(obj, axis, target, spec.get("flatten"))
    smooth(obj, spec.get("smooth"))
    set_origin_bottom_center(obj)

    obj.name = name
    obj.data.name = name
    out_path = os.path.join(out_dir, "%s.glb" % name)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_image_format="NONE",
        export_yup=True,
    )

    obj.data.calc_loop_triangles()
    dims = obj.dimensions
    print(
        "BUILT %-13s tris=%-5d dim=(%.3f, %.3f, %.3f) parts=%d scale=%.4f turn=%.0f kb=%.1f%s"
        % (
            name,
            len(obj.data.loop_triangles),
            dims.x,
            dims.y,
            dims.z,
            parts,
            factor,
            math.degrees(turn),
            os.path.getsize(out_path) / 1024,
            "  UNMAPPED=%s" % unmapped if unmapped else "",
        )
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--pack", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", default=None)
    args = parser.parse_args(argv)

    os.makedirs(args.out, exist_ok=True)
    names = [args.only] if args.only else list(ASSETS)
    for name in names:
        build(name, ASSETS[name], args.pack, args.out)


main()
