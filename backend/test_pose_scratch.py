import cv2
import numpy as np

# 3D model points for generic face (anthropometric model)
FACE_3D_MODEL = np.array([
    (0.0, 0.0, 0.0),          # Nose tip
    (0.0, -330.0, -65.0),      # Chin
    (-225.0, 170.0, -135.0),   # Left eye corner
    (225.0, 170.0, -135.0),    # Right eye corner
    (-150.0, -150.0, -125.0),  # Left mouth corner
    (150.0, -150.0, -125.0)    # Right mouth corner
], dtype=np.float64)

def estimate_pose_from_2d_points(points_2d: np.ndarray, img_w: int, img_h: int):
    focal_length = img_w
    center = (img_w / 2, img_h / 2)
    camera_matrix = np.array([
        [focal_length, 0, center[0]],
        [0, focal_length, center[1]],
        [0, 0, 1]
    ], dtype=np.float64)
    dist_coeffs = np.zeros((4, 1), dtype=np.float64)
    
    success, rvec, tvec = cv2.solvePnP(
        FACE_3D_MODEL,
        points_2d,
        camera_matrix,
        dist_coeffs,
        flags=cv2.SOLVEPNP_ITERATIVE
    )
    if not success:
        return 0.0, 0.0, 0.0
    
    rmat, _ = cv2.Rodrigues(rvec)
    angles, _, _, _, _, _ = cv2.RQDecomp3x3(rmat)
    # angles[0] = pitch, angles[1] = yaw, angles[2] = roll (in degrees)
    pitch = float(angles[0])
    yaw = float(angles[1])
    roll = float(angles[2])
    return yaw, pitch, roll

if __name__ == "__main__":
    # Test synthetic frontal face
    frontal_2d = np.array([
        (250.0, 250.0),  # Nose
        (250.0, 360.0),  # Chin
        (180.0, 190.0),  # Left eye
        (320.0, 190.0),  # Right eye
        (200.0, 300.0),  # Left mouth
        (300.0, 300.0)   # Right mouth
    ], dtype=np.float64)
    yaw, pitch, roll = estimate_pose_from_2d_points(frontal_2d, 500, 500)
    print(f"Frontal Pose: Yaw={yaw:.1f}, Pitch={pitch:.1f}, Roll={roll:.1f}")
    assert abs(yaw) < 10.0, "Frontal yaw should be close to 0"

    # Test synthetic right-turned face (nose shifts right relative to eyes)
    turned_2d = np.array([
        (290.0, 250.0),  # Nose shifts right
        (280.0, 360.0),  # Chin
        (210.0, 190.0),  # Left eye
        (335.0, 190.0),  # Right eye
        (230.0, 300.0),  # Left mouth
        (315.0, 300.0)   # Right mouth
    ], dtype=np.float64)
    yaw_turned, _, _ = estimate_pose_from_2d_points(turned_2d, 500, 500)
    print(f"Turned Pose: Yaw={yaw_turned:.1f}")
    delta_yaw = abs(yaw_turned - yaw)
    print(f"Delta Yaw: {delta_yaw:.1f} degrees")
    assert delta_yaw >= 10.0, "Delta yaw should be >= 10 degrees"
    print("SolvePnP 3D pose test passed successfully!")
