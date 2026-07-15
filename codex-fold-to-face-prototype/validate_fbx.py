import bpy
from pathlib import Path

path = Path(__file__).resolve().parent / "assets" / "models" / "silver-vine-glasses-touchdesigner.fbx"
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.fbx(filepath=str(path), automatic_bone_orientation=False)

required = ["Frame", "Lens_L", "Lens_R", "Temple_L", "Temple_R"]
missing = [name for name in required if bpy.data.objects.get(name) is None]
for name in required:
    obj = bpy.data.objects.get(name)
    if obj:
        print("VALIDATE", name, obj.type, tuple(round(v, 4) for v in obj.location), "parent", obj.parent.name if obj.parent else "NONE")
if missing:
    raise RuntimeError("Missing required objects: " + ", ".join(missing))
print("VALIDATION_OK", path.stat().st_size)
