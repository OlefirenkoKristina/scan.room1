import bpy
print("VERSION", bpy.app.version_string, "ENGINE", bpy.context.scene.render.engine)
tot=0
rows=[]
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        n=sum(len(p.vertices)-2 for p in o.data.polygons)
        tot+=n
        rows.append((n,o.name,len(o.material_slots),o.hide_viewport or o.hide_render))
rows.sort(reverse=True)
print("OBJECTS",len(bpy.context.scene.objects),"MESHES",len(rows),"TRIS",tot)
for r in rows[:25]: print("MESH",r)
print("LIGHTS",[(o.name,o.data.type,o.data.energy) for o in bpy.context.scene.objects if o.type=='LIGHT'])
imgs=[(i.name,i.size[0],i.size[1],i.packed_file is not None) for i in bpy.data.images]
print("IMAGES",len(imgs))
for i in sorted(imgs,key=lambda x:-x[1]*x[2])[:25]: print("IMG",i)
w=bpy.context.scene.world
print("WORLD",w.name if w else None, w.use_nodes if w else None)
