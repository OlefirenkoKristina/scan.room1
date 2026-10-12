import bpy, math, numpy as np
s = bpy.context.scene
s.render.engine='CYCLES'; s.cycles.device='CPU'; s.cycles.samples=4; s.cycles.use_denoising=False
def sel(o):
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
hi = bpy.data.objects["Meshy_Chair_1"]
print("DBG hi dims", hi.dimensions, "scale", hi.scale, "rot", hi.rotation_euler, "verts", len(hi.data.vertices))
lo = hi.copy(); lo.data = hi.data.copy(); lo.name="lo"
for c in hi.users_collection: c.objects.link(lo)
sel(lo); bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.remove_doubles(threshold=1e-5); bpy.ops.object.mode_set(mode="OBJECT"); print("DBG merged verts", len(lo.data.vertices))
m = lo.modifiers.new("d",'DECIMATE'); m.ratio = 14000/189026; m.use_collapse_triangulate=True
sel(lo); bpy.ops.object.modifier_apply(modifier="d"); bpy.ops.object.shade_smooth()
lo.data.materials.clear(); host = bpy.data.materials.new("h"); host.use_nodes=True; lo.data.materials.append(host)
for l in list(lo.data.uv_layers): lo.data.uv_layers.remove(l)
sel(lo); lo.data.uv_layers.new(name="BakeUV")
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004, scale_to_bounds=True); bpy.ops.object.mode_set(mode='OBJECT')
for a in ("visible_camera","visible_diffuse","visible_glossy","visible_transmission","visible_volume_scatter","visible_shadow"): setattr(lo,a,False)
def run(label, **kw):
    img = bpy.data.images.new("t",256,256,alpha=False,float_buffer=True)
    nt = host.node_tree; n = nt.nodes.new("ShaderNodeTexImage"); n.image=img; nt.nodes.active=n; n.select=True
    bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active=lo
    try: bpy.ops.object.bake(type='COMBINED', pass_filter={'DIRECT','INDIRECT','DIFFUSE','EMIT'}, margin=0, use_selected_to_active=True, use_clear=True, **kw)
    except Exception as e: print("DBG err", e)
    a = np.array(img.pixels[:]).reshape(-1,4)[:,:3]
    print("DBG", label, kw, "coverage", round(float((a.sum(1)>0.02).mean()),3), "mean", round(float(a.mean()),3))
    img.save_render('C:/Users/II/AppData/Local/Temp/claude/C--Users-II-work-scan-room1/a78c56ad-1149-4b3a-a0b2-9fca22059206/scratchpad/dbg_'+label+'.png'); nt.nodes.remove(n); bpy.data.images.remove(img)
run("A", cage_extrusion=0.02, max_ray_distance=0.05)



# UV area of lo
import bmesh
bm = bmesh.new(); bm.from_mesh(lo.data); uv = bm.loops.layers.uv.active
area = 0.0
for f in bm.faces:
    p = [l[uv].uv for l in f.loops]
    area += 0.5*abs((p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[2].x-p[0].x)*(p[1].y-p[0].y))
print("DBG uv area", round(area,3), "faces", len(bm.faces))
