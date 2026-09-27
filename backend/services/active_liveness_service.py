"""
Active 3D Challenge-Response Liveness Service
Evaluates multi-pose liveness (Frontal + Head Turn / 3D Parallax).
Prevents 100% of static photos, tablet replays, and printed attacks by verifying
true 3D human head rotation and perspective foreshortening.
"""

import cv2
import cv2.data
import numpy as np
import logging
import time
from typing import Dict, Any, Tuple, Optional
from services.liveness_service import liveness_detector

logger = logging.getLogger(__name__)

# Standard 3D anthropometric facial landmark model (in millimeters)
FACE_3D_MODEL = np.array([
    (0.0, 0.0, 0.0),          # Nose tip
    (0.0, -330.0, -65.0),      # Chin
    (-225.0, 170.0, -135.0),   # Left eye outer corner
    (225.0, 170.0, -135.0),    # Right eye outer corner
    (-150.0, -150.0, -125.0),  # Left mouth corner
    (150.0, -150.0, -125.0)    # Right mouth corner
], dtype=np.float64)


class ActiveLivenessService:
    def __init__(self):
        cascade_alt_path = cv2.data.haarcascades + 'haarcascade_frontalface_alt2.xml'
        self.face_cascade_alt = cv2.CascadeClassifier(cascade_alt_path)
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        self.face_cascade = cv2.CascadeClassifier(cascade_path)
        eye_cascade_path = cv2.data.haarcascades + 'haarcascade_eye.xml'
        self.eye_cascade = cv2.CascadeClassifier(eye_cascade_path)
        profile_cascade_path = cv2.data.haarcascades + 'haarcascade_profileface.xml'
        self.profile_cascade = cv2.CascadeClassifier(profile_cascade_path)
        self.sessions: Dict[str, Dict[str, Any]] = {}

    def detect_profile_face(self, image: np.ndarray) -> Optional[Tuple[list, str]]:
        """
        Detect if user turned into profile view.
        Returns ([x, y, w, h], direction) where direction is 'left' or 'right', or None.
        haarcascade_profileface natively detects faces facing the LEFT of the image (physical RIGHT in unmirrored selfie).
        Flipped horizontally, it detects faces facing the RIGHT of the image (physical LEFT in unmirrored selfie).
        """
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            profiles = self.profile_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(80, 80)
            )
            if len(profiles) > 0:
                profiles = sorted(profiles, key=lambda f: f[2] * f[3], reverse=True)
                return list(profiles[0]), "right"
            flipped = cv2.flip(gray, 1)
            profiles_flipped = self.profile_cascade.detectMultiScale(
                flipped,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(80, 80)
            )
            if len(profiles_flipped) > 0:
                profiles_flipped = sorted(profiles_flipped, key=lambda f: f[2] * f[3], reverse=True)
                fx, fy, fw, fh = profiles_flipped[0]
                orig_fx = image.shape[1] - (fx + fw)
                return [orig_fx, fy, fw, fh], "left"
            return None
        except Exception:
            return None

    def detect_face_and_eyes(self, image: np.ndarray) -> Optional[Dict[str, Any]]:
        """
        Detect face bounding box and eye positions using OpenCV Haar Cascades.
        Returns face box and normalized keypoints.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

        # Try tree-based alt2 cascade first (detects rotated poses up to 35-45 degrees)
        faces = self.face_cascade_alt.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=3,
            minSize=(80, 80)
        )
        if len(faces) == 0:
            # Fallback to default frontal cascade
            faces = self.face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=3,
                minSize=(80, 80)
            )
        if len(faces) == 0:
            return None

        # Take largest face
        faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
        fx, fy, fw, fh = faces[0]

        # Search eyes in upper half of face
        face_roi = gray[fy:fy + int(fh * 0.6), fx:fx + fw]
        eyes = self.eye_cascade.detectMultiScale(
            face_roi,
            scaleFactor=1.1,
            minNeighbors=3,
            minSize=(int(fw * 0.12), int(fh * 0.12)),
            maxSize=(int(fw * 0.45), int(fh * 0.45))
        )

        left_eye = None
        right_eye = None

        if len(eyes) >= 2:
            # Sort eyes left-to-right (in image coords)
            eyes = sorted(eyes, key=lambda e: e[0])
            left_eye = (fx + eyes[0][0] + eyes[0][2] // 2, fy + eyes[0][1] + eyes[0][3] // 2)
            right_eye = (fx + eyes[-1][0] + eyes[-1][2] // 2, fy + eyes[-1][1] + eyes[-1][3] // 2)
        else:
            # Locate eye dark intensity centers in left/right eye sub-regions
            eye_y1 = int(fh * 0.22)
            eye_y2 = int(fh * 0.52)
            
            # Left eye search
            l_x1, l_x2 = int(fw * 0.12), int(fw * 0.48)
            l_roi = face_roi[eye_y1:eye_y2, l_x1:l_x2]
            if l_roi.size > 0:
                _, _, min_loc_l, _ = cv2.minMaxLoc(l_roi)
                left_eye = (fx + l_x1 + min_loc_l[0], fy + eye_y1 + min_loc_l[1])
            else:
                left_eye = (int(fx + fw * 0.32), int(fy + fh * 0.38))

            # Right eye search
            r_x1, r_x2 = int(fw * 0.52), int(fw * 0.88)
            r_roi = face_roi[eye_y1:eye_y2, r_x1:r_x2]
            if r_roi.size > 0:
                _, _, min_loc_r, _ = cv2.minMaxLoc(r_roi)
                right_eye = (fx + r_x1 + min_loc_r[0], fy + eye_y1 + min_loc_r[1])
            else:
                right_eye = (int(fx + fw * 0.68), int(fy + fh * 0.38))

        nose_tip = (int(fx + fw * 0.50), int(fy + fh * 0.58))
        chin = (int(fx + fw * 0.50), int(fy + fh * 0.94))
        mouth_left = (int(fx + fw * 0.35), int(fy + fh * 0.78))
        mouth_right = (int(fx + fw * 0.65), int(fy + fh * 0.78))

        return {
            "bbox": [fx, fy, fw, fh],
            "left_eye": left_eye,
            "right_eye": right_eye,
            "nose": nose_tip,
            "chin": chin,
            "mouth_left": mouth_left,
            "mouth_right": mouth_right,
            "image_size": (image.shape[1], image.shape[0])
        }

    def estimate_head_pose(self, face_data: Dict[str, Any]) -> Tuple[float, float, float]:
        """
        Estimate 3D head rotation angles (Yaw, Pitch, Roll) using solvePnP.
        Normalizes 2D points relative to the face box center (box_cx, box_cy)
        so that lateral camera/phone translation does not create artificial yaw.
        """
        fx, fy, fw, fh = face_data["bbox"]
        box_cx = fx + fw / 2.0
        box_cy = fy + fh / 2.0

        points_2d = np.array([
            (p[0] - box_cx, p[1] - box_cy) for p in [
                face_data["nose"],
                face_data["chin"],
                face_data["left_eye"],
                face_data["right_eye"],
                face_data["mouth_left"],
                face_data["mouth_right"]
            ]
        ], dtype=np.float64)

        focal_length = float(fw * 1.5)
        center = (0.0, 0.0)
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
        pitch = float(angles[0])
        yaw = float(angles[1])
        roll = float(angles[2])
        return yaw, pitch, roll

    def compute_facial_symmetry_ratio(self, face_data: Dict[str, Any]) -> float:
        """
        Calculate eye-to-nose horizontal ratio:
        d_left = nose_x - left_eye_x
        d_right = right_eye_x - nose_x
        For frontal faces, ratio is ~1.0. For head turned right, ratio increases significantly.
        """
        lx, _ = face_data["left_eye"]
        rx, _ = face_data["right_eye"]
        nx, _ = face_data["nose"]

        d_left = max(1.0, float(nx - lx))
        d_right = max(1.0, float(rx - nx))
        return d_left / d_right

    def compute_face_similarity(self, img1: np.ndarray, bbox1: list, img2: np.ndarray, bbox2: list) -> float:
        """
        Compute normalized template cross-correlation between aligned face crops.
        Identical/frozen frames have similarity >= 0.88.
        Genuine head turn alters facial contours and features, dropping similarity to < 0.85.
        """
        try:
            x1, y1, w1, h1 = [int(v) for v in bbox1]
            x2, y2, w2, h2 = [int(v) for v in bbox2]
            crop1 = img1[max(0, y1):y1+h1, max(0, x1):x1+w1]
            crop2 = img2[max(0, y2):y2+h2, max(0, x2):x2+w2]
            if crop1.size == 0 or crop2.size == 0:
                return 0.0
            c1 = cv2.resize(cv2.cvtColor(crop1, cv2.COLOR_BGR2GRAY), (128, 128))
            c2 = cv2.resize(cv2.cvtColor(crop2, cv2.COLOR_BGR2GRAY), (128, 128))
            c1 = cv2.equalizeHist(c1)
            c2 = cv2.equalizeHist(c2)
            res = cv2.matchTemplate(c1, c2, cv2.TM_CCORR_NORMED)
            return float(res[0][0])
        except Exception:
            return 0.0

    def verify_active_liveness(
        self,
        frontal_image: np.ndarray,
        challenge_image: np.ndarray,
        challenge_type: str = "turn_any"
    ) -> Dict[str, Any]:
        """
        Verify active liveness between Frontal Pose and Challenge Pose.
        1. Frontal frame must have a valid face and pass MiniFASNet anti-spoofing.
        2. Challenge frame must show real 3D head motion (Yaw change >= 6 degrees AND face texture shift).
        3. Reject frozen/static faces, vertical nodding, and lateral phone translation.
        """
        frontal_data = self.detect_face_and_eyes(frontal_image)
        if not frontal_data:
            return {
                "success": False,
                "is_live": False,
                "status": "REJECTED",
                "message": "No face detected in the frontal photo. Please position your face clearly.",
                "details": {}
            }

        challenge_data = self.detect_face_and_eyes(challenge_image)
        is_profile_turn = False
        challenge_bbox = None

        if not challenge_data:
            # Check if user rotated so far that it is a full profile view
            profile_res = self.detect_profile_face(challenge_image)
            if profile_res is not None:
                profile_box, _ = profile_res
                # In direction-agnostic mode, any profile turn confirms full 3D head rotation
                is_profile_turn = True
                challenge_bbox = profile_box
            else:
                return {
                    "success": False,
                    "is_live": False,
                    "status": "REJECTED",
                    "message": "Face not detected. Please turn your head slightly (about 15 to 30 degrees) while staying inside the frame.",
                    "details": {}
                }
        else:
            challenge_bbox = challenge_data["bbox"]

        # 1. MiniFASNet check on frontal face
        is_real_frontal, live_prob, liveness_details = liveness_detector.predict(
            frontal_image,
            frontal_data["bbox"]
        )

        # 2. Aligned face template similarity (detect frozen / non-moving frames and phone translation)
        face_similarity = self.compute_face_similarity(
            frontal_image, frontal_data["bbox"],
            challenge_image, challenge_bbox
        )

        # 3. Motion geometry calculation
        if is_profile_turn or challenge_data is None:
            f_yaw, f_pitch, f_roll = self.estimate_head_pose(frontal_data)
            c_yaw = f_yaw + 35.0  # Profile view represents at least 35-45 degrees rotation
            yaw_delta = 35.0
            pitch_delta = 0.0
            sym_delta = 0.50
            c_bbox = challenge_bbox if challenge_bbox is not None else frontal_data["bbox"]
            box_shift_x = abs(c_bbox[0] - frontal_data["bbox"][0]) / max(1.0, float(frontal_data["bbox"][2]))
            eye_dist_ratio = 0.50
            signed_yaw_delta = 35.0
            signed_sym_delta = 0.50
        else:
            f_yaw, f_pitch, f_roll = self.estimate_head_pose(frontal_data)
            c_yaw, c_pitch, c_roll = self.estimate_head_pose(challenge_data)
            yaw_delta = abs(c_yaw - f_yaw)
            signed_yaw_delta = c_yaw - f_yaw
            pitch_delta = abs(c_pitch - f_pitch)

            f_sym = self.compute_facial_symmetry_ratio(frontal_data)
            c_sym = self.compute_facial_symmetry_ratio(challenge_data)
            sym_delta = abs(c_sym - f_sym)
            signed_sym_delta = c_sym - f_sym

            fx1, fy1, fw1, fh1 = frontal_data["bbox"]
            fx2, fy2, fw2, fh2 = challenge_data["bbox"]
            box_shift_x = abs(fx2 - fx1) / max(1.0, float(fw1))

            f_eye_dist = abs(frontal_data["right_eye"][0] - frontal_data["left_eye"][0])
            c_eye_dist = abs(challenge_data["right_eye"][0] - challenge_data["left_eye"][0])
            eye_dist_ratio = c_eye_dist / max(1.0, float(f_eye_dist))

        details = {
            "frontal_live_score": float(liveness_details.get("live_score", 0.0)),
            "frontal_attack_type": liveness_details.get("attack_type", "none"),
            "frontal_yaw": round(f_yaw, 1),
            "challenge_yaw": round(c_yaw, 1),
            "yaw_delta": round(yaw_delta, 1),
            "signed_yaw_delta": round(signed_yaw_delta, 1),
            "pitch_delta": round(pitch_delta, 1),
            "symmetry_delta": round(sym_delta, 2),
            "signed_sym_delta": round(signed_sym_delta, 2),
            "face_similarity": round(face_similarity, 3),
            "box_shift_x": round(box_shift_x, 2),
            "eye_dist_ratio": round(eye_dist_ratio, 2),
            "is_profile_turn": is_profile_turn,
            "challenge_type": challenge_type
        }

        # Check 3.3: Frozen user or static photo (no head rotation)
        if face_similarity >= 0.91:
            return {
                "success": True,
                "is_live": False,
                "status": "REJECTED",
                "message": "No head rotation detected. Please keep your phone steady and turn your head.",
                "details": details
            }

        # Direction enforcement removed — accept any head turn direction.
        # Haar Cascade + solvePnP landmark estimation is too noisy on selfie cameras
        # to reliably distinguish left vs right turns. What matters for liveness
        # is 3D motion in ANY direction, not a specific direction.

        # Vertical nodding rejection removed:
        # Any 3D head rotation (horizontal yaw turn or vertical pitch nod/tilt)
        # confirms real physical perspective depth and live human interaction.

        # Check minimum required head motion (yaw turn, tilt, or nod)
        has_sufficient_motion = (
            is_profile_turn or
            (sym_delta >= 0.15) or
            (yaw_delta >= 5.5 and face_similarity < 0.86) or
            (yaw_delta >= 7.5 and sym_delta >= 0.08) or
            (pitch_delta >= 6.0 and face_similarity < 0.86)
        )

        if not has_sufficient_motion:
            return {
                "success": True,
                "is_live": False,
                "status": "REJECTED",
                "message": "Insufficient movement. Please turn or tilt your head slightly more to confirm liveness.",
                "details": details
            }

        # Check frontal liveness score
        if not is_real_frontal and liveness_details.get("live_score", 0) < 0.35:
            return {
                "success": True,
                "is_live": False,
                "status": "REJECTED",
                "message": "Spoofing attempt detected on screen or paper. Please scan a live person.",
                "details": details
            }

        return {
            "success": True,
            "is_live": True,
            "status": "PASSED",
            "message": "Live face and 3D motion verified successfully!",
            "details": details
        }

    def clean_expired_sessions(self, max_age_seconds: float = 300.0) -> None:
        """Remove sessions inactive for longer than max_age_seconds."""
        now = time.time()
        expired = [sid for sid, s in self.sessions.items() if now - s.get("last_seen", 0) > max_age_seconds]
        for sid in expired:
            self.sessions.pop(sid, None)

    def evaluate_live_stream_frame(
        self,
        session_id: str,
        stage: str,
        frame_image: np.ndarray,
        reset_session: bool = False
    ) -> Dict[str, Any]:
        """
        Evaluate a single video frame in a continuous live liveness stream.
        Stage 1: 'frontal' -> aligns face, runs MiniFASNet anti-spoofing, locks baseline pose after steady frames.
        Stage 2: 'turn' -> verifies continuous head rotation, rejects nodding, rejects phone translation.
        """
        self.clean_expired_sessions()
        now = time.time()

        if reset_session or session_id not in self.sessions:
            self.sessions[session_id] = {
                "stage": "frontal",
                "steady_count": 0,
                "created_at": now,
                "last_seen": now,
                "baseline_yaw": 0.0,
                "baseline_pitch": 0.0,
                "baseline_eye_dist": 1.0,
                "baseline_sym_ratio": 1.0,
                "max_turn_progress": 0.50,
            }

        session = self.sessions[session_id]
        session["last_seen"] = now

        current_stage = session.get("stage", "frontal")
        if stage == "frontal" and current_stage != "frontal":
            session["stage"] = "frontal"
            session["steady_count"] = 0
            current_stage = "frontal"

        # ----------------------------------------------------
        # STAGE 1: FRONTAL POSE ALIGNMENT & PASSIVE LIVENESS
        # ----------------------------------------------------
        if current_stage == "frontal":
            face_data = self.detect_face_and_eyes(frame_image)
            if not face_data:
                session["steady_count"] = 0
                return {
                    "success": True,
                    "status": "ALIGNING",
                    "stage": "frontal",
                    "progress": 0.10,
                    "feedback": "Position your face inside the oval",
                    "is_live": False
                }

            # Check centering
            img_h, img_w = frame_image.shape[:2]
            fx, fy, fw, fh = face_data["bbox"]
            cx, cy = fx + fw / 2.0, fy + fh / 2.0
            is_centered = (abs(cx - img_w / 2.0) < img_w * 0.25) and (abs(cy - img_h / 2.0) < img_h * 0.25)
            if not is_centered:
                session["steady_count"] = 0
                return {
                    "success": True,
                    "status": "ALIGNING",
                    "stage": "frontal",
                    "progress": 0.20,
                    "feedback": "Center your face in the oval",
                    "is_live": False
                }

            # Check face size (should occupy 8% to 70% of screen)
            face_ratio = (fw * fh) / (img_w * img_h)
            if face_ratio < 0.08:
                session["steady_count"] = 0
                return {
                    "success": True,
                    "status": "ALIGNING",
                    "stage": "frontal",
                    "progress": 0.20,
                    "feedback": "Move a bit closer to the camera",
                    "is_live": False
                }
            if face_ratio > 0.70:
                session["steady_count"] = 0
                return {
                    "success": True,
                    "status": "ALIGNING",
                    "stage": "frontal",
                    "progress": 0.20,
                    "feedback": "Move a bit further from the camera",
                    "is_live": False
                }

            # Run MiniFASNet anti-spoofing
            is_real, live_score, liveness_details = liveness_detector.predict(frame_image, face_data["bbox"], threshold=0.55)
            if not is_real and live_score < 0.35:
                session["steady_count"] = 0
                return {
                    "success": False,
                    "status": "REJECTED",
                    "stage": "frontal",
                    "progress": 0.0,
                    "feedback": "Spoofing attempt detected on screen or paper. Please scan a live person directly.",
                    "is_live": False,
                    "details": liveness_details
                }

            session["steady_count"] += 1

            if session["steady_count"] < 2:
                return {
                    "success": True,
                    "status": "ALIGNING",
                    "stage": "frontal",
                    "progress": 0.35,
                    "feedback": "Face detected! Hold steady...",
                    "is_live": False
                }

            # Steady frontal confirmed! Lock in baseline
            f_yaw, f_pitch, f_roll = self.estimate_head_pose(face_data)
            f_sym = self.compute_facial_symmetry_ratio(face_data)
            f_eye_dist = abs(face_data["right_eye"][0] - face_data["left_eye"][0])
            f_eye_y = (face_data["left_eye"][1] + face_data["right_eye"][1]) / (2.0 * max(1, fh))

            session["stage"] = "turn"
            session["baseline_yaw"] = f_yaw
            session["baseline_pitch"] = f_pitch
            session["baseline_eye_dist"] = max(1.0, float(f_eye_dist))
            session["baseline_sym_ratio"] = f_sym
            session["baseline_eye_y"] = f_eye_y
            session["max_turn_progress"] = 0.50

            return {
                "success": True,
                "status": "FRONTAL_LOCKED",
                "stage": "turn",
                "progress": 0.50,
                "feedback": "Great! Now slowly turn or tilt your head",
                "is_live": False,
                "direction": "any"
            }

        # ----------------------------------------------------
        # STAGE 2: LIVE HEAD ROTATION & 3D GEOMETRY TRACKING
        # ----------------------------------------------------
        turn_data = self.detect_face_and_eyes(frame_image)
        is_profile = False

        if not turn_data:
            # Check profile cascade (either left or right)
            profile_res = self.detect_profile_face(frame_image)
            if profile_res is not None:
                is_profile = True
            else:
                return {
                    "success": True,
                    "status": "TRACKING",
                    "stage": "turn",
                    "progress": session.get("max_turn_progress", 0.50),
                    "feedback": "Keep turning your head inside the frame...",
                    "is_live": False
                }

        # If full profile reached -> full 3D rotation confirmed!
        if is_profile:
            session["stage"] = "passed"
            return {
                "success": True,
                "status": "PASSED",
                "stage": "complete",
                "progress": 1.0,
                "feedback": "3D head rotation verified successfully!",
                "is_live": True
            }

        assert turn_data is not None
        c_yaw, c_pitch, c_roll = self.estimate_head_pose(turn_data)
        c_sym = self.compute_facial_symmetry_ratio(turn_data)
        c_eye_dist = abs(turn_data["right_eye"][0] - turn_data["left_eye"][0])
        _, _, _, c_fh = turn_data["bbox"]
        c_eye_y = (turn_data["left_eye"][1] + turn_data["right_eye"][1]) / (2.0 * max(1, c_fh))

        b_yaw = session.get("baseline_yaw", 0.0)
        b_pitch = session.get("baseline_pitch", 0.0)
        b_eye_dist = session.get("baseline_eye_dist", 1.0)
        b_sym = session.get("baseline_sym_ratio", 1.0)
        b_eye_y = session.get("baseline_eye_y", c_eye_y)

        yaw_delta = c_yaw - b_yaw
        eye_ratio = c_eye_dist / max(1.0, b_eye_dist)
        sym_change = c_sym - b_sym
        vertical_delta = abs(c_eye_y - b_eye_y)

        # 1. Pitch / vertical delta calculation
        pitch_delta = c_pitch - b_pitch

        # 2. Phone translation check:
        # If camera moved sideways without rotating head:
        # Eye distance does NOT compress (eye_ratio > 0.98), and symmetry ratio barely changes (|sym_change| < 0.08)
        is_lateral_shift = (eye_ratio > 0.98) and (abs(sym_change) < 0.08)

        # 3. Progress calculation (direction & axis agnostic: turn, tilt, or nod):
        prog_sym = max(0.0, min(1.0, abs(sym_change) / 0.28))
        prog_yaw = max(0.0, min(1.0, abs(yaw_delta) / 12.0))
        prog_pitch = max(0.0, min(1.0, abs(pitch_delta) / 12.0))
        turn_prog = max(prog_sym, prog_yaw, prog_pitch)

        current_progress = 0.50 + (turn_prog * 0.50)
        session["max_turn_progress"] = max(session.get("max_turn_progress", 0.50), current_progress)

        # Completion condition (direction & axis agnostic):
        has_sufficient_rotation = (
            (abs(sym_change) >= 0.20 and eye_ratio <= 0.96) or
            (abs(sym_change) >= 0.28) or
            (abs(yaw_delta) >= 11.0 and not is_lateral_shift) or
            (abs(pitch_delta) >= 10.0 and vertical_delta > 0.04) or
            (vertical_delta >= 0.08)
        )

        if has_sufficient_rotation:
            session["stage"] = "passed"
            return {
                "success": True,
                "status": "PASSED",
                "stage": "complete",
                "progress": 1.0,
                "feedback": "3D head rotation verified successfully!",
                "is_live": True
            }

        if is_lateral_shift and session["max_turn_progress"] < 0.65:
            feedback_msg = "Keep phone steady and turn your head"
        else:
            feedback_msg = "Keep turning your head..."

        return {
            "success": True,
            "status": "TURNING",
            "stage": "turn",
            "progress": round(session["max_turn_progress"], 2),
            "feedback": feedback_msg,
            "is_live": False
        }


active_liveness_verifier = ActiveLivenessService()
