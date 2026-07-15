import bpy
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / "assets" / "models" / "silver-vine-glasses.glb"
target = root / "assets" / "models" / "silver-vine-glasses-touchdesigner.fbx"

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))

for obj in bpy.context.scene.objects:
    obj.select_set(True)

bpy.ops.export_scene.fbx(
    filepath=str(target),
    use_selection=False,
    object_types={"EMPTY", "MESH"},
    apply_unit_scale=True,
    apply_scale_options="FBX_SCALE_ALL",
    axis_forward="-Z",
    axis_up="Y",
    bake_anim=False,
    add_leaf_bones=False,
    path_mode="COPY",
    embed_textures=True,
)

print("FBX_EXPORT", target, target.stat().st_size)
print("OBJECTS", ", ".join(sorted(obj.name for obj in bpy.context.scene.objects)))
