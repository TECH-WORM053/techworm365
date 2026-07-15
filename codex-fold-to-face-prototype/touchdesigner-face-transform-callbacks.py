import math


def onSetupParameters(scriptOp):
    return


def onPulse(par):
    return


def _clamp(value, low, high):
    return max(low, min(high, value))


def onCook(scriptOp):
    source = scriptOp.inputs[0] if scriptOp.inputs else None
    scriptOp.clear()
    scriptOp.numSamples = 1

    channel_names = (
        'pos_x', 'pos_y', 'depth',
        'rot_x', 'rot_y', 'rot_z',
        'scale', 'tracked_yaw', 'object_scale',
    )
    outputs = {name: scriptOp.appendChan(name) for name in channel_names}

    if source is None or source.numChans < 16:
        for channel in outputs.values():
            channel[0] = 0
        return

    def value(name):
        channel = source[name]
        return float(channel[0]) if channel is not None else 0.0

    m00, m10, m20 = value('m00'), value('m10'), value('m20')
    m01, m11, m21 = value('m01'), value('m11'), value('m21')
    m02, m12, m22 = value('m02'), value('m12'), value('m22')

    pos_x = (value('m03') - 0.5) * 2.0
    pos_y = (0.5 - value('m13')) * 2.0
    depth = value('m23')

    scale_x = math.sqrt(m00*m00 + m10*m10 + m20*m20)
    scale_y = math.sqrt(m01*m01 + m11*m11 + m21*m21)
    scale_z = math.sqrt(m02*m02 + m12*m12 + m22*m22)
    canonical_scale = (scale_x + scale_y + scale_z) / 3.0

    if canonical_scale > 0.000001:
        r00, r10, r20 = m00/canonical_scale, m10/canonical_scale, m20/canonical_scale
        r21, r22 = m21/canonical_scale, m22/canonical_scale
        rot_x = math.degrees(math.atan2(r21, r22))
        rot_y = math.degrees(math.atan2(-r20, math.sqrt(r00*r00 + r10*r10)))
        rot_z = math.degrees(math.atan2(r10, r00))
    else:
        rot_x = rot_y = rot_z = 0.0

    tracked_yaw = _clamp(-rot_y * 0.45, -32.0, 32.0)
    tracked_pitch = _clamp(rot_x * 0.5, -20.0, 20.0)
    tracked_roll = _clamp(rot_z, -30.0, 30.0)
    object_scale = _clamp(depth * 1.23, 0.12, 0.45)

    values = {
        'pos_x': pos_x, 'pos_y': pos_y, 'depth': depth,
        'rot_x': tracked_pitch, 'rot_y': rot_y, 'rot_z': tracked_roll,
        'scale': canonical_scale, 'tracked_yaw': tracked_yaw,
        'object_scale': object_scale,
    }
    for name, output in outputs.items():
        output[0] = values[name]

    glasses = op('/project1/glasses_root')
    if glasses is None:
        return

    # Orthographic camera: normalized MediaPipe coordinates map directly to screen space.
    glasses.par.tx = pos_x * 1.35
    glasses.par.ty = pos_y * 2.0 - 0.20
    glasses.par.tz = 0
    glasses.par.rx = tracked_pitch
    glasses.par.ry = tracked_yaw
    glasses.par.rz = tracked_roll
    glasses.par.sx = object_scale
    glasses.par.sy = object_scale
    glasses.par.sz = object_scale
