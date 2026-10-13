import bpy, numpy as np
s = bpy.context.scene
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type='CUDA'; p.get_devices()
for d in p.devices: d.use = d.type=='CUDA'
s.render.engine='CYCLES'; s.cycles.samples=16; s.cycles.use_denoising=False
o = bpy.data.objects["Meshy_Desk_A"]
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active=o
print("DBG lights", [(l.name, l.hide_render, l.data.energy) for l in s.objects if l.type=='LIGHT'])
print("DBG world", s.world.node_tree.nodes.keys() if s.world and s.world.use_nodes else None)
mat = o.material_slots[0].material
nt = mat.node_tree
print("DBG nodes", [(n.type, n.name) for n in nt.nodes])
def run(dev, **kw):
    s.cycles.device = dev
    img = bpy.data.images.new("t", 256, 256, alpha=False, float_buffer=True)
    n = nt.nodes.new("ShaderNodeTexImage"); n.image = img; nt.nodes.active = n; n.select = True
    try:
        bpy.ops.object.bake(type='COMBINED', margin=4, **kw)
    except Exception as e: print("DBG err", e)
    a = np.array(img.pixels[:]).reshape(-1,4)
    print("DBG", dev, kw, "mean", a[:,:3].mean(), "max", a[:,:3].max(), "nonzero", (a[:,:3].sum(1)>0).mean())
    nt.nodes.remove(n); bpy.data.images.remove(img)
run('GPU'); run('CPU'); run('CPU', pass_filter={'DIRECT','INDIRECT','DIFFUSE','EMIT'})
