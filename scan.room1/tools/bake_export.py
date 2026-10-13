"""Optimise room_furnished.blend for the web.

Heavy Meshy props are decimated into low-poly copies; Blender's lighting + materials are baked
(Cycles, high-poly -> low-poly for props) into one texture per object; the result is exported as a
light GLB whose materials are plain emissive textures (exact look, no real-time lighting needed).

Run headless:
  blender -b room_furnished.blend -P bake_export.py -- <workdir> <out.glb>
Env: BAKE_ONLY (comma list; other objects reuse the jpgs already in <workdir>), BAKE_SAMPLES (default 256), BAKE_SCALE (texture size multiplier, default 1; use 0.5 for drafts)
"""
import bpy, os, sys, json, math, time

WORK, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(WORK, exist_ok=True)
scene = bpy.context.scene
T0 = time.time()
def log(*a): print("BAKE", f"[{time.time()-T0:6.0f}s]", *a, flush=True)

# --- camera info for the viewer (Blender Z-up coords) ---
cam = scene.camera
json.dump({"camera": {"loc": list(cam.matrix_world.translation), "fov": math.degrees(cam.data.angle_y),
                      "quat": list(cam.matrix_world.to_quaternion())}},
          open(os.path.join(WORK, "camera.json"), "w"))

# CUDA bake returns black with the installed (old) NVIDIA driver, so bake on the CPU.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = int(os.environ.get("BAKE_SAMPLES", 256))
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 92
scene.render.image_settings.color_mode = 'RGB'

SCALE = float(os.environ.get("BAKE_SCALE", 1))
ONLY = set(filter(None, os.environ.get("BAKE_ONLY", "").split(",")))
GLASS_MATS = {"Glass", "Plastic_film"}
FILL_BLACK = {"Wardrobe_frame"}
GLOSSY_OBJS = {"Spot_Housing"}
FLAT_MATS = {"PVC_White", "Handle_Metal"}
TARGET = {"Meshy_Chair_1": 14000, "Meshy_Chair_2": 14000, "Meshy_Chair_blue": 14000,
          "Meshy_Shelf": 10000}
# Desks are baked directly from their own surface (no decimated copy / high->low projection): the
# projection bake left black texels in the cable slots and the decimation left the tops bumpy.
DESKS = ["Meshy_Desk_window", "Meshy_Desk_A", "Meshy_Desk_B", "Meshy_Desk_end"]

def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o

def tris(o): return sum(len(p.vertices) - 2 for p in o.data.polygons)

def hide_from_rays(o):
    for a in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission",
              "visible_volume_scatter", "visible_shadow"):
        setattr(o, a, False)

def res_for(o):
    if any(s.material and s.material.name in FLAT_MATS for s in o.material_slots): return 512
    n = o.name
    if n in DESKS: return max(128, int(2048 * SCALE))
    if n in ("Floor", "Ceiling", "Wall_x0", "Wall_x1", "Wall_y0", "Wall_y1"): r = 2048
    else: r = 1024
    return max(128, int(r * SCALE))

# --- 1. split Openings by material so glass can stay transparent ---
select_only(bpy.data.objects["Openings"])
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')

# --- 1a. Desk_end: the Meshy mesh is badly mangled (crumpled legs, cable slot, bumpy top) -> rebuild clean ---
import bmesh
def rebuild_desk_end():
    old = bpy.data.objects["Meshy_Desk_end"]
    mat = old.data.materials[0]
    W, D, H, T, P = 1.2, 0.6, 0.82, 0.04, 0.02          # width, depth, height, top & panel thickness
    bm = bmesh.new()
    def box(x0, x1, y0, y1, z0, z1):
        bmesh.ops.create_cube(bm, size=1.0)
        v = [v for v in bm.verts][-8:]
        for vert in v:
            vert.co.x = x1 if vert.co.x > 0 else x0
            vert.co.y = y1 if vert.co.y > 0 else y0
            vert.co.z = z1 if vert.co.z > 0 else z0
    box(-W/2, W/2, -D/2, D/2, H - T, H)                  # top
    box(-W/2, -W/2 + P, -D/2, D/2, 0, H - T)             # left panel
    box(W/2 - P, W/2, -D/2, D/2, 0, H - T)               # right panel
    me = bpy.data.meshes.new("Meshy_Desk_end_clean"); bm.to_mesh(me); bm.free()
    new = bpy.data.objects.new("tmp_desk_end", me)
    new.matrix_world = old.matrix_world
    for c in old.users_collection: c.objects.link(new)
    bpy.data.objects.remove(old, do_unlink=True)
    new.name = "Meshy_Desk_end"
    me.materials.append(mat)
    select_only(new)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.0)             # ~1 wood-texture tile per metre
    bpy.ops.object.mode_set(mode='OBJECT')
    log("rebuilt Meshy_Desk_end")
if os.environ.get("REBUILD_DESK_END", "1") == "1": rebuild_desk_end()

# --- 1c. all chairs black: reuse the black material of Meshy_Chair_2 (same mesh/UVs as the others) ---
BLACK_CHAIRS = ["Meshy_Chair_1", "Meshy_Chair_blue"]
_black = bpy.data.objects["Meshy_Chair_2"].data.materials[0]
for name in BLACK_CHAIRS:
    bpy.data.objects[name].data.materials[0] = _black

# --- 1b. desks: weld UV seams, then flatten near-planar faces (removes the AI-mesh bumpiness) ---
for name in DESKS:
    d = bpy.data.objects[name]; select_only(d)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.mesh.dissolve_limited(angle_limit=math.radians(float(os.environ.get("DESK_DISSOLVE", 5))),
                                  delimit={'MATERIAL', 'UV'})
    bpy.ops.object.mode_set(mode='OBJECT')
    log("flatten", name, tris(d))

# --- 2. low-poly copies of the Meshy props (originals stay as the high-poly bake source) ---
pairs = {}                                    # low-poly object -> high-poly object
for name, tgt in TARGET.items():
    hi = bpy.data.objects[name]
    lo = hi.copy(); lo.data = hi.data.copy(); lo.name = name + "_lo"
    for c in hi.users_collection: c.objects.link(lo)
    select_only(lo)
    # Meshy meshes are split along UV seams; weld them first or Decimate leaves cracks.
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode='OBJECT')
    m = lo.modifiers.new("dec", 'DECIMATE'); m.decimate_type = 'COLLAPSE'
    m.ratio = min(1.0, tgt / tris(lo)); m.use_collapse_triangulate = True
    select_only(lo)
    with bpy.context.temp_override(object=lo, active_object=lo):
        bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.shade_smooth()
    lo.data.materials.clear()
    host = bpy.data.materials.new(name + "_host"); host.use_nodes = True
    lo.data.materials.append(host)
    for l in list(lo.data.uv_layers): lo.data.uv_layers.remove(l)
    hide_from_rays(lo)
    pairs[lo] = hi
    log("decimate", name, tris(hi), "->", tris(lo))

# --- 3. bake ---
def pin_uv_nodes(o, orig_uv):
    """Materials keep sampling the original UV layer even after BakeUV becomes the render layer."""
    for s in o.material_slots:
        nt = s.material.node_tree
        for n in list(nt.nodes):
            if n.type == 'TEX_IMAGE' and not n.inputs["Vector"].is_linked:
                um = nt.nodes.new("ShaderNodeUVMap"); um.uv_map = orig_uv
                nt.links.new(um.outputs["UV"], n.inputs["Vector"])

def is_glass(o):
    return o.material_slots and all((s.material and s.material.name in GLASS_MATS) for s in o.material_slots)

baked = {}                                    # object -> baked jpg path
glass = []
for o in [o for o in list(scene.objects) if o.type == 'MESH' and not o.name.endswith("_lo")] + list(pairs):
    hi = pairs.get(o)
    reuse = bool(ONLY) and o.name not in ONLY
    if hi is None and is_glass(o):
        glass.append(o); continue
    if reuse and not os.path.exists(os.path.join(WORK, f"{o.name}.jpg")): continue

    orig_uv = o.data.uv_layers[0].name if len(o.data.uv_layers) else None
    if orig_uv and hi is None: pin_uv_nodes(o, orig_uv)
    select_only(o)
    o.data.uv_layers.new(name="BakeUV"); o.data.uv_layers.active_index = len(o.data.uv_layers) - 1
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004 if hi else 0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    o.data.uv_layers["BakeUV"].active_render = True
    if reuse:                                 # texture from an earlier run (same deterministic UVs)
        baked[o] = os.path.join(WORK, f"{o.name}.jpg"); log("reuse", o.name); continue

    R = res_for(o)
    img = bpy.data.images.new(f"bake_{o.name}", R, R, alpha=False, float_buffer=True)
    nodes = []
    for s in o.material_slots:
        nt = s.material.node_tree; n = nt.nodes.new("ShaderNodeTexImage"); n.image = img
        nt.nodes.active = n; n.select = True; nodes.append((nt, n))
    bpy.ops.object.select_all(action='DESELECT')
    if hi: hi.select_set(True)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    flt = {'DIRECT', 'INDIRECT', 'DIFFUSE', 'EMIT'} | ({'GLOSSY'} if o.name in GLOSSY_OBJS else set())
    kw = dict(use_selected_to_active=True, cage_extrusion=0.02, max_ray_distance=0.05) if hi else {}
    bpy.ops.object.bake(type='COMBINED', pass_filter=flt, margin=8, use_clear=True, **kw)
    for nt, n in nodes: nt.nodes.remove(n)
    path = os.path.join(WORK, f"{o.name}.jpg")
    img.save_render(path, scene=scene)        # applies AgX + exposure => final look baked in
    bpy.data.images.remove(img)
    if o.name in FILL_BLACK:                  # hidden/embedded faces bake to black squares: paint them with the median colour
        import numpy as np
        im = bpy.data.images.load(path); px = np.array(im.pixels[:]).reshape(-1, 4)
        lum = px[:, :3].mean(1); lit = lum > 0.05
        med = np.median(px[lit, :3], axis=0); bad = lum < 0.2 * np.median(lum[lit])
        px[bad, :3] = med; im.pixels[:] = px.reshape(-1).tolist()
        im.filepath_raw = path; im.file_format = 'JPEG'; im.save(); bpy.data.images.remove(im)
        log("filled dark texels", o.name, int(bad.sum()))
    baked[o] = path
    log("baked", o.name, R, [s.material.name for s in o.material_slots])

# --- 4. swap in the baked materials only now (emissive props must not light the other bakes) ---
def emissive_mat(name, img, color=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage") if color is None else None
    if tex: tex.image = img
    bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    bsdf.inputs["Roughness"].default_value = 1.0
    if tex: nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
    else: bsdf.inputs["Emission Color"].default_value = (*color, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 1.0
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m

def glass_mat():
    m = bpy.data.materials.new("Glass_web"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.85, 0.92, 0.95, 1); b.inputs["Alpha"].default_value = 0.12
    b.inputs["Roughness"].default_value = 0.05
    return m

for o, path in baked.items():
    flat = any(s.material and s.material.name in FLAT_MATS for s in o.material_slots)
    final = bpy.data.images.load(path); final.name = f"{o.name}_baked"
    color = None
    if flat:                                  # thin bars get ~no texels: use the mean baked colour
        import numpy as np
        px = np.array(final.pixels[:]).reshape(-1, 4)[:, :3]; px = px[px.sum(1) > 0.05]
        color = tuple(float(c) for c in px.mean(0)) if len(px) else (0.45, 0.45, 0.47)   # metal: diffuse bake is black
        bpy.data.images.remove(final); final = None
        log("flat", o.name, color)
    else: final.pack()
    orig_uv = [l.name for l in o.data.uv_layers if l.name != "BakeUV"]
    for n in orig_uv: o.data.uv_layers.remove(o.data.uv_layers[n])
    o.data.materials.clear(); o.data.materials.append(emissive_mat(f"{o.name}_mat", final, color))
for o in glass:
    o.data.materials.clear(); o.data.materials.append(glass_mat()); log("glass", o.name)
for lo, hi in pairs.items():
    bpy.data.objects.remove(hi, do_unlink=True)
    lo.name = lo.name[:-3]
    for a in ("visible_camera", "visible_diffuse", "visible_glossy", "visible_transmission",
              "visible_volume_scatter", "visible_shadow"): setattr(lo, a, True)

# --- 5. cleanup + export ---
for o in list(scene.objects):
    if o.type in ('LIGHT', 'CAMERA'): bpy.data.objects.remove(o)
bpy.ops.outliner.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORK, "room_baked.blend"), copy=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True,
    export_cameras=False, export_lights=False, export_image_format='JPEG', export_jpeg_quality=90,
    export_texcoords=True, export_normals=False, export_tangents=False, export_materials='EXPORT')
log("exported", OUT, os.path.getsize(OUT) // 1024, "KB")
