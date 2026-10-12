import bpy
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        mats=[]
        for s in o.material_slots:
            m=s.material
            imgs=[n.image.name for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image] if m and m.use_nodes else []
            mats.append((m.name if m else None,imgs))
        print("OBJ",o.name,o.data.name,[round(x,2) for x in o.location],[round(x,2) for x in o.dimensions],[uv.name for uv in o.data.uv_layers],mats)
    elif o.type!='LIGHT': print("OTHER",o.name,o.type)
s=bpy.context.scene
print("CAM",s.camera.name if s.camera else None, "unit",s.unit_settings.scale_length)
print("VIEW",s.view_settings.view_transform,s.view_settings.look,s.view_settings.exposure)
