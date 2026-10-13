import bpy
p=bpy.context.preferences.addons['cycles'].preferences
for t in ('OPTIX','CUDA','HIP','ONEAPI','NONE'):
    try:
        p.compute_device_type=t; p.get_devices()
        print("GPUCHK",t,[(d.name,d.type) for d in p.devices])
    except Exception as e: print("GPUCHK",t,"err")
