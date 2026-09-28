"""
Deep-Learning ID Verification Service
Validates ID legitimacy, detects cardholder portrait on ID,
evaluates card geometry, and extracts text using RapidOCR (PP-OCRv4 ONNX).
"""

import os
import re
import cv2
import numpy as np
import logging
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger(__name__)

PHILIPPINE_ID_KEYWORDS = {
    "philsys": [
        "REPUBLIKA NG PILIPINAS", "REPUBLIKANG PILIPINAS", "REPUBLIC OF THE PHILIPPINES",
        "PAMBANSANG PAGKAKAKILANLAN", "PHILIPPINE IDENTIFICATION",
        "PHILSYS", "PHILID"
    ],
    "drivers_license": [
        "REPUBLIC OF THE PHILIPPINES", "DEPARTMENT OF TRANSPORTATION",
        "LAND TRANSPORTATION OFFICE", "DRIVER'S LICENSE", "DRIVERS LICENSE", "LTO"
    ],
    "umid": [
        "UNIFIED MULTI-PURPOSE ID", "UMID", "REPUBLIC OF THE PHILIPPINES",
        "SOCIAL SECURITY SYSTEM", "GSIS", "CRN"
    ],
    "voters_id": [
        "REPUBLIC OF THE PHILIPPINES", "COMMISSION ON ELECTIONS", "COMELEC",
        "VOTER'S IDENTIFICATION", "VOTER"
    ],
    "postal": [
        "PHILPOST", "POSTAL ID", "PHILIPPINE POSTAL CORPORATION", "POSTAL IDENTIFICATION"
    ],
    "philhealth": [
        "PHILHEALTH", "PHILIPPINE HEALTH INSURANCE CORPORATION"
    ],
    "tin": [
        "BUREAU OF INTERNAL REVENUE", "TIN", "TAXPAYER IDENTIFICATION"
    ],
    "barangay": [
        "BARANGAY", "TANGGAPAN NG PUNONG BARANGAY", "OFFICE OF THE BARANGAY", "RESIDENT"
    ],
    "senior": [
        "SENIOR CITIZEN", "OFFICE OF SENIOR CITIZENS AFFAIRS", "OSCA"
    ],
    "passport": [
        "PASAPORTE", "PASSPORT", "REPUBLIKA NG PILIPINAS", "DEPARTMENT OF FOREIGN AFFAIRS"
    ]
}

# General legitimacy signals
GENERAL_LEGIT_TERMS = [
    "REPUBLIC OF THE PHILIPPINES", "REPUBLIKA NG PILIPINAS",
    "IDENTIFICATION", "ID NUMBER", "DATE OF BIRTH", "BIRTHDATE",
    "ADDRESS", "NAME", "PANGALAN", "SEX", "SIGNATURE", "PILIPINAS"
]

class IDVerificationService:
    def __init__(self):
        self.ocr_engine = None
        self._init_ocr()
        
        # Load Haar Cascade for detecting portrait photo on ID card
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        self.face_cascade = cv2.CascadeClassifier(cascade_path)

    def _init_ocr(self):
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.ocr_engine = RapidOCR(
                intra_op_num_threads=1,
                inter_op_num_threads=1,
                det_limit_side_len=720,
                det_limit_type='max',
                rec_batch_num=1,
                use_cls=False
            )
            logger.info("[IDVerificationService] RapidOCR ONNX engine initialized successfully (low-memory 1-thread mode).")
        except Exception as e:
            logger.error(f"[IDVerificationService] Failed to initialize RapidOCR: {e}", exc_info=True)
            self.ocr_engine = None

    def detect_portrait_on_id(self, image: np.ndarray) -> Tuple[bool, int, List[List[int]]]:
        """
        Check if the ID document contains a photo portrait of the cardholder.
        Real government IDs must have a printed portrait face.
        """
        try:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            # Enhance local contrast for printed card photos
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)
            
            # Detect faces with scale factor tuned for small card portraits
            faces = self.face_cascade.detectMultiScale(
                enhanced,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(30, 30),
                maxSize=(int(image.shape[0] * 0.9), int(image.shape[1] * 0.6))
            )
            
            face_count = len(faces)
            # Standard ID has 1 main portrait, plus optional ghost hologram and security seals/coat of arms
            has_portrait = 1 <= face_count <= 4
            
            bbox_list = [[int(x), int(y), int(w), int(h)] for (x, y, w, h) in faces]
            return has_portrait, face_count, bbox_list
        except Exception as e:
            logger.error(f"[IDVerificationService] Portrait face detection failed: {e}")
            return False, 0, []

    def check_card_geometry(self, image: np.ndarray) -> Tuple[bool, float, str]:
        """
        Check if the image aspect ratio conforms to standard ID cards (ISO/IEC 7810 ID-1: ~1.58:1 ratio).
        Horizontal: 1.05 to 2.10 ratio (tolerant to mobile photo crops).
        Vertical: 0.50 to 0.90 ratio.
        """
        h, w = image.shape[:2]
        if h == 0 or w == 0:
            return False, 0.0, "invalid"

        ratio = w / float(h)
        
        # Horizontal standard ID card
        if 1.05 <= ratio <= 2.10:
            return True, round(ratio, 2), "horizontal_card"
        # Vertical format ID card
        elif 0.50 <= ratio <= 0.90:
            return True, round(ratio, 2), "vertical_card"
        else:
            return False, round(ratio, 2), "non_standard_aspect_ratio"

    def extract_text(self, image: np.ndarray) -> Tuple[str, List[Dict[str, Any]], float]:
        """
        Extract text using RapidOCR (PP-OCRv4).
        Returns full text, word blocks with bounding boxes and confidences, and average confidence.
        """
        if self.ocr_engine is None:
            return "", [], 0.0

        try:
            results, elapse = self.ocr_engine(image)
            if not results:
                return "", [], 0.0

            lines = []
            blocks = []
            total_conf = 0.0

            for item in results:
                box, text, conf = item
                text = str(text).strip()
                if not text:
                    continue
                lines.append(text)
                total_conf += float(conf)
                
                # Format box
                pts = np.array(box, dtype=np.int32)
                x = int(np.min(pts[:, 0]))
                y = int(np.min(pts[:, 1]))
                bw = int(np.max(pts[:, 0]) - x)
                bh = int(np.max(pts[:, 1]) - y)

                blocks.append({
                    "text": text,
                    "confidence": round(float(conf), 3),
                    "boundingBox": {"x": x, "y": y, "width": bw, "height": bh}
                })

            full_text = "\n".join(lines)
            avg_conf = (total_conf / len(blocks)) if blocks else 0.0

            return full_text, blocks, round(avg_conf * 100, 2)
        except Exception as e:
            logger.error(f"[IDVerificationService] OCR extraction failed: {e}", exc_info=True)
            return "", [], 0.0

    def match_id_number(self, full_text: str, expected_id_number: Optional[str]) -> Tuple[Optional[str], bool]:
        """
        Search for potential ID number in text and compare with expected_id_number if provided.
        """
        if not expected_id_number:
            # Try to find sequences with digits like 1234-5678-9012 or D01-23-456789
            patterns = [
                r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b', # PhilSys 16 digits
                r'\b\d{4}[-\s]?\d{7}[-\s]?\d\b',             # PhilSys CRN
                r'\b[A-Z]\d{2}[-\s]?\d{2}[-\s]?\d{6}\b',      # Driver's license
                r'\b\d{2}[-\s]?\d{7}[-\s]?\d\b',             # SSS/UMID
                r'\b\d{4}[-\s]?\d{4}[-\s]?\d{4}\b'           # PhilHealth 12 digits
            ]
            for pat in patterns:
                m = re.search(pat, full_text)
                if m:
                    return m.group(0).strip(), False
            return None, False

        clean_expected = re.sub(r'[\s-]', '', expected_id_number).upper()
        clean_text = re.sub(r'[\s-]', '', full_text).upper()

        if clean_expected in clean_text:
            return expected_id_number, True

        # Fuzzy check: allow 1-2 character OCR misreads
        import difflib
        for line in full_text.splitlines():
            clean_line = re.sub(r'[\s-]', '', line).upper()
            if len(clean_line) >= len(clean_expected) - 2:
                matcher = difflib.SequenceMatcher(None, clean_expected, clean_line)
                match = matcher.find_longest_match(0, len(clean_expected), 0, len(clean_line))
                if match.size >= len(clean_expected) - 1:
                    return expected_id_number, True

        return None, False

    def auto_crop_card(self, image: np.ndarray) -> Tuple[np.ndarray, bool]:
        """
        Detects card boundary within image and crops to the ID card itself.
        Returns (cropped_or_original_image, was_cropped).
        """
        try:
            if image is None or image.size == 0:
                return image, False
            h, w = image.shape[:2]
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            blurred = cv2.GaussianBlur(gray, (5, 5), 0)
            edged = cv2.Canny(blurred, 30, 150)

            # Find external contours
            contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                return image, False

            contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
            img_area = float(h * w)

            for c in contours:
                area = cv2.contourArea(c)
                # Card should occupy between 10% and 98% of image area
                if area < 0.10 * img_area or area > 0.98 * img_area:
                    continue

                peri = cv2.arcLength(c, True)
                approx = cv2.approxPolyDP(c, 0.02 * peri, True)

                # Check if rectangular contour
                if len(approx) in [4, 5, 6] or cv2.isContourConvex(approx):
                    bx, by, bw, bh = cv2.boundingRect(c)
                    if bh == 0:
                        continue
                    aspect = bw / float(bh)
                    # Standard card aspect ratio (1.10 to 2.15 horizontal, or 0.5 to 0.9 vertical)
                    if (1.10 <= aspect <= 2.15 or 0.50 <= aspect <= 0.90) and bw > 150 and bh > 100:
                        pad_x = int(bw * 0.02)
                        pad_y = int(bh * 0.02)
                        x0 = max(0, bx - pad_x)
                        y0 = max(0, by - pad_y)
                        x1 = min(w, bx + bw + pad_x)
                        y1 = min(h, by + bh + pad_y)
                        cropped = image[y0:y1, x0:x1]
                        if cropped.size > 0:
                            logger.info(f"[IDVerificationService] Auto-crop: card boundary detected ({bw}x{bh}, ratio {round(aspect, 2)})")
                            return cropped, True

            return image, False
        except Exception as e:
            logger.debug(f"[IDVerificationService] auto_crop_card skipped: {e}")
            return image, False

    def verify_document(
        self,
        image: np.ndarray,
        id_type: Optional[str] = None,
        expected_id_number: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Comprehensive ID Verification Pipeline.
        1. Auto-crop to card boundary
        2. Aspect Ratio / Geometry
        3. Cardholder Portrait Face Detection
        4. Deep-Learning OCR text extraction
        5. Philippine Government Keyword matching
        6. ID Number verification
        """
        reasons = []
        scores = {}

        # Downscale image immediately to max 720px to ensure total memory stays under 180MB on 512MB RAM hosts
        if image is not None and image.size > 0:
            h, w = image.shape[:2]
            max_dim = max(h, w)
            if max_dim > 720:
                scale = 720.0 / max_dim
                image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        # 0. Auto-crop to card boundary if card is framed on a background
        working_image, was_auto_cropped = self.auto_crop_card(image)
        if was_auto_cropped:
            reasons.append("Card boundary automatically detected and aligned.")

        # 1. Geometry Check
        has_valid_ratio, ratio, card_orientation = self.check_card_geometry(working_image)
        scores["geometry_ratio"] = ratio
        scores["card_orientation"] = card_orientation
        if has_valid_ratio:
            reasons.append("Card dimensions match standard ID card format.")
        else:
            reasons.append("The document type could not be confirmed with high confidence.")

        # 2. Face Portrait on ID Check
        has_portrait, face_count, face_boxes = self.detect_portrait_on_id(working_image)
        scores["has_portrait"] = has_portrait
        scores["portrait_face_count"] = face_count
        if has_portrait:
            if face_count == 1:
                reasons.append("Cardholder portrait photo detected on ID.")
            else:
                reasons.append(f"Cardholder portrait photo detected on ID (including security hologram/seal, {face_count} regions found).")
        elif face_count == 0:
            reasons.append("No cardholder portrait photo detected on document (real IDs have a photo).")
        else:
            reasons.append(f"Excessive face-like regions ({face_count}) detected on document.")

        # 3. Deep-Learning OCR
        full_text, blocks, avg_conf = self.extract_text(working_image)
        scores["ocr_confidence"] = avg_conf
        scores["total_words"] = len(blocks)

        upper_text = full_text.upper()

        # 4. Keyword Analysis
        detected_keywords = []
        matched_category = "unknown"

        # Check specific ID type first if provided
        no_space_upper = re.sub(r'[\s\-_]', '', upper_text)

        def kw_matches(kw: str) -> bool:
            if kw in upper_text:
                return True
            clean_kw = re.sub(r'[\s\-_]', '', kw)
            return len(clean_kw) >= 4 and clean_kw in no_space_upper

        if id_type and id_type.lower() in PHILIPPINE_ID_KEYWORDS:
            for kw in PHILIPPINE_ID_KEYWORDS[id_type.lower()]:
                if kw_matches(kw):
                    detected_keywords.append(kw)
                    matched_category = id_type.lower()

        # Search all Philippine ID keywords
        for cat, kws in PHILIPPINE_ID_KEYWORDS.items():
            for kw in kws:
                if kw_matches(kw) and kw not in detected_keywords:
                    detected_keywords.append(kw)
                    if matched_category == "unknown":
                        matched_category = cat

        # Check general legitimacy terms
        for term in GENERAL_LEGIT_TERMS:
            if kw_matches(term) and term not in detected_keywords:
                detected_keywords.append(term)

        if len(detected_keywords) == 0:
            reasons.insert(0, "The document type could not be confirmed with high confidence (no official Philippine government headers detected).")

        # 5. ID Number Matching
        extracted_id, id_number_matched = self.match_id_number(full_text, expected_id_number)
        scores["id_number_matched"] = id_number_matched
        if extracted_id:
            reasons.append(f"ID number detected: {extracted_id}")

        # Compute overall Legitimacy Confidence (0 to 100)
        legit_score = 0.0

        # Weights:
        # - Portrait photo on ID: 35%
        # - Official keywords: 35%
        # - Card geometry: 15%
        # - OCR text clarity & word count: 15%

        if has_portrait:
            legit_score += 35.0
        
        if len(detected_keywords) >= 2:
            legit_score += 35.0
        elif len(detected_keywords) == 1:
            legit_score += 20.0

        if has_valid_ratio:
            legit_score += 15.0

        if len(blocks) >= 6 and avg_conf > 50.0:
            legit_score += 15.0
        elif len(blocks) >= 3:
            legit_score += 8.0

        if id_number_matched:
            legit_score = min(100.0, legit_score + 10.0)

        # Decision threshold: 50+ out of 100 with at least 1 keyword and a photo
        is_valid_id = bool(
            (legit_score >= 50.0 and (has_portrait or len(detected_keywords) >= 2)) or
            (len(detected_keywords) >= 3)
        )

        import gc
        gc.collect()

        return {
            "is_valid_id": is_valid_id,
            "confidence": round(legit_score, 1),
            "has_portrait_face": has_portrait,
            "aspect_ratio_valid": has_valid_ratio,
            "extracted_id_number": extracted_id,
            "id_number_matched": id_number_matched,
            "detected_keywords": detected_keywords,
            "card_type_detected": matched_category,
            "raw_text": full_text,
            "blocks": blocks,
            "reasons": reasons,
            "scores": scores
        }

id_verifier = IDVerificationService()
