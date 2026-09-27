"""
MiniFASNet Passive Face Anti-Spoofing Service
Detects presentation attacks (printed photos, phone screens, monitors, Pinterest photos)
using MiniFASNetV2 ONNX model with zero user friction.
"""

import os
import cv2
import numpy as np
import logging
from typing import Tuple, Dict, Any, Optional

logger = logging.getLogger(__name__)

class MiniFASNetDetector:
    def __init__(self, model_path: Optional[str] = None):
        if model_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            model_path = os.path.join(base_dir, "models", "minifasnet", "minifasnet_v2.onnx")
        
        self.model_path = model_path
        self.session = None
        self.is_loaded = False
        self._load_model()

    def _load_model(self):
        try:
            if not os.path.exists(self.model_path):
                logger.warning(f"[MiniFASNet] Model file not found at {self.model_path}. Anti-spoofing will use fallback.")
                return

            import onnxruntime as ort
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self.session = ort.InferenceSession(self.model_path, options, providers=["CPUExecutionProvider"])
            self.is_loaded = True
            logger.info(f"[MiniFASNet] Successfully loaded model from {self.model_path}")
        except Exception as e:
            logger.error(f"[MiniFASNet] Failed to initialize ONNX session: {e}", exc_info=True)
            self.session = None
            self.is_loaded = False

    def crop_face_with_scale(self, image: np.ndarray, bbox: list, scale: float = 2.7) -> np.ndarray:
        """
        Crop face region with margin scale without adding artificial black borders.
        Clamps scale dynamically so the crop stays inside real camera pixels,
        matching official DeepFace FasNet and Silent-Face-Anti-Spoofing.
        """
        src_h, src_w = image.shape[:2]
        x, y, box_w, box_h = bbox
        
        # Dynamically clamp scale so crop does not exceed camera image boundaries
        clamped_scale = min((src_h - 1) / max(1, box_h), min((src_w - 1) / max(1, box_w), scale))
        new_width = box_w * clamped_scale
        new_height = box_h * clamped_scale
        
        center_x = box_w / 2.0 + x
        center_y = box_h / 2.0 + y
        
        left_top_x = center_x - new_width / 2.0
        left_top_y = center_y - new_height / 2.0
        right_bottom_x = center_x + new_width / 2.0
        right_bottom_y = center_y + new_height / 2.0
        
        # Shift crop window if near edges instead of injecting black borders
        if left_top_x < 0:
            right_bottom_x -= left_top_x
            left_top_x = 0
        if left_top_y < 0:
            right_bottom_y -= left_top_y
            left_top_y = 0
        if right_bottom_x > src_w - 1:
            left_top_x -= right_bottom_x - src_w + 1
            right_bottom_x = src_w - 1
        if right_bottom_y > src_h - 1:
            left_top_y -= right_bottom_y - src_h + 1
            right_bottom_y = src_h - 1
            
        x1 = max(0, int(left_top_x))
        y1 = max(0, int(left_top_y))
        x2 = min(src_w, int(right_bottom_x) + 1)
        y2 = min(src_h, int(right_bottom_y) + 1)
        
        cropped = image[y1:y2, x1:x2]
        return cropped

    def predict(self, image: np.ndarray, bbox: list, threshold: float = 0.65) -> Tuple[bool, float, Dict[str, Any]]:
        """
        Run passive anti-spoofing check on a face.
        
        Args:
            image: BGR format image (numpy ndarray)
            bbox: [x, y, width, height] of the detected face
            threshold: Probability threshold for real face (default 0.65)
            
        Returns:
            (is_real, live_score, details_dict)
            Class 0: Print attack (printed paper/card)
            Class 1: Live (Genuine human face)
            Class 2: Replay attack (Screen / monitor / Pinterest phone image)
        """
        if not self.is_loaded or self.session is None:
            return self._fallback_heuristic(image, bbox)

        try:
            # Dual-scale evaluation (context 2.7x + facial detail 1.5x)
            crop_context = self.crop_face_with_scale(image, bbox, scale=2.7)
            crop_detail = self.crop_face_with_scale(image, bbox, scale=1.5)

            if crop_context.size == 0 or crop_detail.size == 0:
                return False, 0.0, {"error": "Invalid face crop", "attack_type": "unknown"}

            input_name = self.session.get_inputs()[0].name

            def evaluate_crop(crop_img: np.ndarray) -> np.ndarray:
                resized = cv2.resize(crop_img, (80, 80), interpolation=cv2.INTER_LINEAR)
                blob = resized.astype(np.float32)
                blob = np.transpose(blob, (2, 0, 1))
                blob = np.expand_dims(blob, axis=0)
                outputs = self.session.run(None, {input_name: blob})[0][0]
                exp_scores = np.exp(outputs - np.max(outputs))
                return exp_scores / np.sum(exp_scores)

            probs_context = evaluate_crop(crop_context)
            probs_detail = evaluate_crop(crop_detail)

            # Combined multi-scale probabilities
            probs = (probs_context + probs_detail) / 2.0

            print_prob = float(probs[0])
            live_prob = float(probs[1])
            replay_prob = float(probs[2])

            pred_class = int(np.argmax(probs))
            
            # If either scale detects a strong attack (screen replay > 65% or print > 65%), block it
            if probs_context[2] > 0.65 or probs_detail[2] > 0.65:
                attack_type = "screen_or_replay"
                is_real = False
            elif probs_context[0] > 0.65 or probs_detail[0] > 0.65:
                attack_type = "printed_photo"
                is_real = False
            else:
                attack_type = "none"
                if pred_class == 0:
                    attack_type = "printed_photo"
                elif pred_class == 2:
                    attack_type = "screen_or_replay"
                is_real = bool(pred_class == 1 and live_prob >= threshold)

            details = {
                "engine": "MiniFASNetV2_DualScale_ONNX",
                "is_real": is_real,
                "live_score": round(live_prob, 4),
                "print_score": round(print_prob, 4),
                "screen_replay_score": round(replay_prob, 4),
                "context_live": round(float(probs_context[1]), 4),
                "detail_live": round(float(probs_detail[1]), 4),
                "predicted_class": pred_class,
                "attack_type": attack_type,
            }

            return is_real, live_prob, details

        except Exception as e:
            logger.error(f"[MiniFASNet] Inference failed: {e}", exc_info=True)
            return self._fallback_heuristic(image, bbox)

    def _fallback_heuristic(self, image: np.ndarray, bbox: list) -> Tuple[bool, float, Dict[str, Any]]:
        """Conservative fallback in case ONNX inference encounters an issue."""
        x, y, w, h = bbox
        face_roi = image[max(0, y):min(image.shape[0], y + h), max(0, x):min(image.shape[1], x + w)]
        if face_roi.size == 0:
            return False, 0.0, {"error": "Empty face region", "engine": "fallback"}
        
        gray = cv2.cvtColor(face_roi, cv2.COLOR_BGR2GRAY)
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        is_real = laplacian_var > 60.0
        score = min(1.0, laplacian_var / 250.0)
        return is_real, score, {
            "engine": "fallback_laplacian",
            "is_real": is_real,
            "blur_score": laplacian_var
        }

# Global singleton instance
liveness_detector = MiniFASNetDetector()
