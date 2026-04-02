import json
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

try:
    import mediapipe as mp
except ImportError:
    mp = None
import pytesseract
from ultralytics import YOLO

try:
    import pyttsx3
except ImportError:
    pyttsx3 = None

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# -----------------------------
# Configuration
# -----------------------------
IMAGE_PATH = "images/test5.jpg"
OUTPUT_DIR = "outputs"
YOLO_MODEL = "yolov8n_saved_model/yolov8n_float16.tflite"  # Pi Zero friendly
INPUT_SIZE = 320
PAPER_CLASS = 73  # COCO class id for book
CONFIDENCE_THRESHOLD = 0.45
EXPAND_FACTOR = 0.15
SHOW_WINDOWS = True
MIN_PAGE_BLUR_VAR = 80.0
MIN_LINE_BLUR_VAR = 50.0
MIN_LINE_HEIGHT = 10
MIN_LINE_WIDTH_RATIO = 0.20
MIN_LINE_INK_RATIO = 0.01
MIN_OCR_CONFIDENCE = 45.0


def order_points(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    return np.array(
        [
            pts[np.argmin(s)],
            pts[np.argmin(diff)],
            pts[np.argmax(s)],
            pts[np.argmax(diff)],
        ],
        dtype="float32",
    )


def detect_page_with_yolo(image: np.ndarray, model: YOLO):
    orig_h, orig_w = image.shape[:2]
    scale = INPUT_SIZE / max(orig_h, orig_w)
    new_w, new_h = int(orig_w * scale), int(orig_h * scale)
    resized = cv2.resize(image, (new_w, new_h))

    results = model.predict(resized, imgsz=INPUT_SIZE, device="cpu", verbose=False)
    boxes = results[0].boxes.xyxy
    scores = results[0].boxes.conf
    classes = results[0].boxes.cls

    candidates = []
    for b, s, c in zip(boxes, scores, classes):
        score = float(s)
        if int(c) == PAPER_CLASS and score >= CONFIDENCE_THRESHOLD:
            x1, y1, x2, y2 = b.cpu().numpy()
            x1, y1, x2, y2 = int(x1 / scale), int(y1 / scale), int(x2 / scale), int(y2 / scale)
            candidates.append((score, [x1, y1, x2, y2]))

    if not candidates:
        return None

    _, (x1, y1, x2, y2) = max(candidates, key=lambda x: x[0])
    w, h = x2 - x1, y2 - y1
    x1 = max(0, x1 - int(w * EXPAND_FACTOR))
    y1 = max(0, y1 - int(h * EXPAND_FACTOR))
    x2 = min(orig_w - 1, x2 + int(w * EXPAND_FACTOR))
    y2 = min(orig_h - 1, y2 + int(h * EXPAND_FACTOR))

    return np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], dtype="float32")


def detect_page_contour(image: np.ndarray):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 160)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    img_area = image.shape[0] * image.shape[1]
    best = None
    best_area = 0

    for cnt in contours:
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        area = cv2.contourArea(approx)
        if len(approx) == 4 and area > best_area and area > 0.12 * img_area:
            best = approx.reshape(4, 2).astype("float32")
            best_area = area

    if best is None:
        return None
    return order_points(best)


def perspective_flatten(image: np.ndarray, src_pts: np.ndarray):
    pts = order_points(src_pts)
    width = int(max(np.linalg.norm(pts[1] - pts[0]), np.linalg.norm(pts[2] - pts[3])))
    height = int(max(np.linalg.norm(pts[3] - pts[0]), np.linalg.norm(pts[2] - pts[1])))
    width = max(width, 10)
    height = max(height, 10)

    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], dtype="float32")
    M = cv2.getPerspectiveTransform(pts, dst)
    flat = cv2.warpPerspective(image, M, (width, height))
    return flat, M


def detect_fingertip_orig(image: np.ndarray):
    if mp is not None:
        mp_hands = mp.solutions.hands
        with mp_hands.Hands(static_image_mode=True, max_num_hands=1, min_detection_confidence=0.2) as hands:
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            result = hands.process(image_rgb)
        if result.multi_hand_landmarks:
            lm = result.multi_hand_landmarks[0].landmark[8]  # index fingertip
            x = int(lm.x * image.shape[1])
            y = int(lm.y * image.shape[0])
            return (x, y), "mediapipe"

    # Fallback: skin color segmentation and top-most point
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    lower = np.array([0, 30, 40], dtype=np.uint8)
    upper = np.array([25, 200, 255], dtype=np.uint8)
    mask = cv2.inRange(hsv, lower, upper)
    mask = cv2.GaussianBlur(mask, (5, 5), 0)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None, "none"

    largest = max(contours, key=cv2.contourArea)
    if cv2.contourArea(largest) < 500:
        return None, "none"

    top_idx = np.argmin(largest[:, :, 1])
    x, y = largest[top_idx][0]
    return (int(x), int(y)), "skin-fallback"


def map_point_to_flat(point_xy, M):
    p = np.array([[[point_xy[0], point_xy[1]]]], dtype=np.float32)
    p2 = cv2.perspectiveTransform(p, M)
    return int(p2[0, 0, 0]), int(p2[0, 0, 1])


def laplacian_variance(image: np.ndarray) -> float:
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def binarize_page(flat: np.ndarray):
    gray = cv2.cvtColor(flat, cv2.COLOR_BGR2GRAY)
    gray = cv2.bilateralFilter(gray, 7, 50, 50)
    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        15,
    )
    binary = cv2.medianBlur(binary, 3)
    return binary


def get_line_boxes(binary_inv: np.ndarray):
    h, w = binary_inv.shape

    # Horizontal projection
    proj = np.sum(binary_inv > 0, axis=1).astype(np.int32)
    thresh = max(8, int(0.025 * w))
    active = proj > thresh

    bands = []
    in_band = False
    start = 0
    for i, v in enumerate(active):
        if v and not in_band:
            start = i
            in_band = True
        elif not v and in_band:
            if i - start >= 6:
                bands.append((start, i - 1))
            in_band = False
    if in_band:
        bands.append((start, h - 1))

    # Build per-line boxes from projection bands (primary path)
    line_boxes = []
    for y1, y2 in bands:
        # reject unusually tall merged regions
        if (y2 - y1) > int(0.08 * h):
            continue

        band = binary_inv[y1 : y2 + 1, :]
        cols = np.sum(band > 0, axis=0)
        col_thresh = max(2, int(0.08 * (y2 - y1 + 1)))
        xs = np.where(cols > col_thresh)[0]
        if len(xs) == 0:
            continue

        x1 = max(0, int(xs[0]) - 2)
        x2 = min(w - 1, int(xs[-1]) + 2)
        line_boxes.append((x1, y1, x2, y2))

    return line_boxes


def line_ink_ratio(binary_inv: np.ndarray, line_box) -> float:
    x1, y1, x2, y2 = line_box
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(binary_inv.shape[1] - 1, x2)
    y2 = min(binary_inv.shape[0] - 1, y2)
    roi = binary_inv[y1 : y2 + 1, x1 : x2 + 1]
    if roi.size == 0:
        return 0.0
    return float(np.count_nonzero(roi) / roi.size)


def select_target_line(line_boxes, fingertip_flat, prefer_below=True, y_bias=4):
    if fingertip_flat is None or not line_boxes:
        return None

    _, fy = fingertip_flat
    fy = fy + y_bias

    # 1) If finger is inside a line band, choose it
    containing = []
    for b in line_boxes:
        _, y1, _, y2 = b
        if y1 <= fy <= y2:
            containing.append(b)

    if containing:
        return min(containing, key=lambda b: abs(((b[1] + b[3]) / 2.0) - fy))

    # 2) Prefer the first line below the finger
    if prefer_below:
        below = [b for b in line_boxes if ((b[1] + b[3]) / 2.0) >= fy]
        if below:
            return min(below, key=lambda b: ((b[1] + b[3]) / 2.0) - fy)

    # 3) Fallback: nearest center
    return min(line_boxes, key=lambda b: abs(((b[1] + b[3]) / 2.0) - fy))


def _ocr_text_and_confidence(img: np.ndarray, config: str):
    data = pytesseract.image_to_data(img, config=config, output_type=pytesseract.Output.DICT)
    words = []
    confs = []
    for txt, conf in zip(data["text"], data["conf"]):
        t = txt.strip()
        try:
            c = float(conf)
        except (TypeError, ValueError):
            continue
        if t and c >= 0:
            words.append(t)
            confs.append(c)

    text = " ".join(words).strip()
    mean_conf = float(np.mean(confs)) if confs else 0.0
    return text, mean_conf


def ocr_single_line(flat: np.ndarray, line_box):
    x1, y1, x2, y2 = line_box
    pad_y, pad_x = 6, 4
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(flat.shape[1] - 1, x2 + pad_x)
    y2 = min(flat.shape[0] - 1, y2 + pad_y)

    line_crop = flat[y1 : y2 + 1, x1 : x2 + 1].copy()
    if line_crop.shape[0] < 48:
        line_crop = cv2.resize(line_crop, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(line_crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    _, thr = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thr = cv2.medianBlur(thr, 3)
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    thr = cv2.morphologyEx(thr, cv2.MORPH_CLOSE, close_kernel, iterations=1)

    # Add white border to help Tesseract segmentation
    gray_b = cv2.copyMakeBorder(gray, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)
    thr_b = cv2.copyMakeBorder(thr, 12, 12, 12, 12, cv2.BORDER_CONSTANT, value=255)

    variants = [
        ("grayscale", gray_b),
        ("thresholded", thr_b),
    ]
    psm_modes = [7, 6, 13]

    best_text = ""
    best_conf = 0.0
    best_img = cv2.cvtColor(gray_b, cv2.COLOR_GRAY2BGR)
    best_method = "grayscale_psm7"

    for variant_name, candidate_img in variants:
        for psm in psm_modes:
            cfg = f"--oem 1 --psm {psm}"
            text, conf = _ocr_text_and_confidence(candidate_img, cfg)
            score = (conf, len(text))
            best_score = (best_conf, len(best_text))
            if score > best_score:
                best_text = text
                best_conf = conf
                best_method = f"{variant_name}_psm{psm}"
                best_img = cv2.cvtColor(candidate_img, cv2.COLOR_GRAY2BGR)

    return line_crop, best_img, best_text.strip(), float(best_conf), best_method


def speak_text(text: str):
    if not text:
        return
    if pyttsx3 is None:
        print("[WARN] pyttsx3 not installed, skipping TTS")
        return
    try:
        engine = pyttsx3.init()
        engine.setProperty("rate", 165)
        engine.say(text)
        engine.runAndWait()
    except Exception as exc:
        print(f"[WARN] TTS failed: {exc}")


def save_outputs(flat, line_crop, ocr_crop, debug_img, selected_text, image_path, metadata):
    out_dir = Path(OUTPUT_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    flat_path = out_dir / f"page_flat_{ts}.jpg"
    line_path = out_dir / f"line_{ts}.jpg"
    ocr_path = out_dir / f"line_ocr_{ts}.jpg"
    debug_path = out_dir / f"debug_{ts}.jpg"
    log_path = out_dir / "readings.jsonl"

    cv2.imwrite(str(flat_path), flat)
    if line_crop is not None:
        cv2.imwrite(str(line_path), line_crop)
    if ocr_crop is not None:
        cv2.imwrite(str(ocr_path), ocr_crop)
    cv2.imwrite(str(debug_path), debug_img)

    record = {
        "timestamp": ts,
        "source_image": image_path,
        "flat_image": str(flat_path),
        "line_image": str(line_path) if line_crop is not None else None,
        "ocr_image": str(ocr_path) if ocr_crop is not None else None,
        "debug_image": str(debug_path),
        "text": selected_text,
    }
    record.update(metadata)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

    return flat_path, line_path, ocr_path, debug_path, log_path


def main():
    image = cv2.imread(IMAGE_PATH)
    if image is None:
        raise ValueError(f"Image not found: {IMAGE_PATH}")

    model = YOLO(YOLO_MODEL, task="detect")

    # 1) Detect paper/page (prefer contour; fallback to detector)
    page_pts = detect_page_contour(image)
    page_method = "contour"
    if page_pts is None:
        page_pts = detect_page_with_yolo(image, model)
        page_method = "yolo"
    if page_pts is None:
        msg = "Page not detected. Please capture again."
        print(f"[FAIL] {msg}")
        speak_text(msg)
        return

    # 2) Perspective-correct page
    flat, M = perspective_flatten(image, page_pts)

    page_blur = laplacian_variance(flat)
    if page_blur < MIN_PAGE_BLUR_VAR:
        msg = "Image is too blurry. Please recapture."
        print(f"[FAIL] {msg} (blur={page_blur:.2f})")
        speak_text(msg)
        return

    # 3) Detect fingertip in original image and map to page coordinates
    tip_orig, tip_method = detect_fingertip_orig(image)
    tip_flat = map_point_to_flat(tip_orig, M) if tip_orig is not None else None

    if tip_flat is None:
        msg = "Finger not detected. Please capture again."
        print(f"[FAIL] {msg}")
        speak_text(msg)
        debug = flat.copy()
        for p in page_pts.astype(int):
            cv2.circle(debug, tuple(p), 4, (0, 0, 255), -1)
        metadata = {
            "status": "finger_not_found",
            "ocr_confidence": 0.0,
            "fingertip": None,
            "selected_line_box": None,
            "page_points": page_pts.astype(int).tolist(),
            "detection_method": {"page": page_method, "finger": tip_method, "line_selection": None, "ocr": None},
            "page_blur": page_blur,
        }
        save_outputs(flat, None, None, debug, "", IMAGE_PATH, metadata)
        return

    # 4) Binarize and extract candidate text lines
    binary_inv = binarize_page(flat)
    line_boxes = get_line_boxes(binary_inv)
    if not line_boxes:
        raise RuntimeError("No text lines found on the corrected page")

    # 5) Choose nearest line to fingertip
    selected_line = select_target_line(line_boxes, tip_flat)
    if selected_line is None:
        msg = "Could not select line near fingertip. Please capture again."
        print(f"[FAIL] {msg}")
        speak_text(msg)
        return

    sx1, sy1, sx2, sy2 = selected_line
    line_w = sx2 - sx1 + 1
    line_h = sy2 - sy1 + 1
    if line_h < MIN_LINE_HEIGHT or line_w < int(MIN_LINE_WIDTH_RATIO * flat.shape[1]):
        msg = "Selected line is too small. Please recapture."
        print(f"[FAIL] {msg}")
        speak_text(msg)
        return

    ink_ratio = line_ink_ratio(binary_inv, selected_line)
    if ink_ratio < MIN_LINE_INK_RATIO:
        msg = "Selected line has too little text. Please recapture."
        print(f"[FAIL] {msg} (ink_ratio={ink_ratio:.4f})")
        speak_text(msg)
        return

    # 6) OCR only selected line
    line_crop, ocr_crop, text, ocr_conf, ocr_method = ocr_single_line(flat, selected_line)
    line_blur = laplacian_variance(line_crop)
    if line_blur < MIN_LINE_BLUR_VAR:
        msg = "Selected line is blurry. Please recapture."
        print(f"[FAIL] {msg} (blur={line_blur:.2f})")
        speak_text(msg)
        return

    if not text or ocr_conf < MIN_OCR_CONFIDENCE:
        msg = "OCR confidence is low. Please recapture."
        print(f"[FAIL] {msg} (confidence={ocr_conf:.2f})")
        speak_text(msg)

        debug = flat.copy()
        for (x1, y1, x2, y2) in line_boxes:
            cv2.rectangle(debug, (x1, y1), (x2, y2), (80, 80, 80), 1)
        cv2.rectangle(debug, (sx1, sy1), (sx2, sy2), (0, 0, 255), 2)
        if tip_flat is not None:
            cv2.circle(debug, (tip_flat[0], tip_flat[1]), 6, (0, 255, 0), -1)

        metadata = {
            "status": "low_ocr_confidence",
            "ocr_confidence": float(ocr_conf),
            "fingertip": [int(tip_flat[0]), int(tip_flat[1])],
            "selected_line_box": [int(sx1), int(sy1), int(sx2), int(sy2)],
            "page_points": page_pts.astype(int).tolist(),
            "detection_method": {
                "page": page_method,
                "finger": tip_method,
                "line_selection": "nearest_vertical_center",
                "ocr": ocr_method,
            },
            "page_blur": float(page_blur),
            "line_blur": float(line_blur),
            "line_ink_ratio": float(ink_ratio),
        }
        save_outputs(flat, line_crop, ocr_crop, debug, text, IMAGE_PATH, metadata)
        return

    # 7) Draw debug overlay
    debug = flat.copy()
    for (x1, y1, x2, y2) in line_boxes:
        cv2.rectangle(debug, (x1, y1), (x2, y2), (80, 80, 80), 1)
    cv2.rectangle(debug, (sx1, sy1), (sx2, sy2), (0, 255, 255), 2)
    if tip_flat is not None:
        tx, ty = tip_flat
        cv2.circle(debug, (tx, ty), 6, (0, 255, 0), -1)
        cv2.putText(debug, f"tip: {tip_method}", (tx + 6, ty - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)

    # 8) Read + save
    print("-------- SELECTED LINE OCR --------")
    print(text)
    print(f"OCR confidence: {ocr_conf:.2f}")
    print("-----------------------------------")

    metadata = {
        "status": "ok",
        "ocr_confidence": float(ocr_conf),
        "fingertip": [int(tip_flat[0]), int(tip_flat[1])],
        "selected_line_box": [int(sx1), int(sy1), int(sx2), int(sy2)],
        "page_points": page_pts.astype(int).tolist(),
        "detection_method": {
            "page": page_method,
            "finger": tip_method,
            "line_selection": "nearest_vertical_center",
            "ocr": ocr_method,
        },
        "page_blur": float(page_blur),
        "line_blur": float(line_blur),
        "line_ink_ratio": float(ink_ratio),
    }

    flat_path, line_path, ocr_path, debug_path, log_path = save_outputs(
        flat,
        line_crop,
        ocr_crop,
        debug,
        text,
        IMAGE_PATH,
        metadata,
    )
    print(f"[OK] Saved flat page: {flat_path}")
    print(f"[OK] Saved line crop: {line_path}")
    print(f"[OK] Saved OCR crop: {ocr_path}")
    print(f"[OK] Saved debug image: {debug_path}")
    print(f"[OK] Appended log: {log_path}")

    # 9) TTS
    speak_text(text)

    if SHOW_WINDOWS:
        cv2.imshow("Flattened Page + Selected Line", debug)
        cv2.imshow("Selected Line Crop", line_crop)
        cv2.waitKey(0)
        cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
