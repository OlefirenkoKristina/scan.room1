import bpy, sys
out = sys.argv[sys.argv.index('--')+1]
s = bpy.context.scene
s.render.resolution_x, s.render.resolution_y = 1280, 720
s.render.filepath = out
bpy.ops.render.render(write_still=True)
