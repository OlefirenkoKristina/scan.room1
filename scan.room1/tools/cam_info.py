import bpy
s=bpy.context.scene; c=s.camera.data
print("CAMI", s.render.resolution_x, s.render.resolution_y, c.sensor_fit, c.angle, c.angle_x, c.angle_y, c.lens, c.sensor_width)
