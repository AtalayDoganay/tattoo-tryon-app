import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageEnhance
import numpy as np
import base64
import io

app = Flask(__name__)
CORS(app)  # Allow calls from localhost:8081


def is_light_background(img):
    rgb = img.convert('RGB')
    w, h = rgb.size
    corners = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((w-1, 0)),
        rgb.getpixel((0, h-1)),
        rgb.getpixel((w-1, h-1)),
        rgb.getpixel((w//2, 0)),
        rgb.getpixel((w//2, h-1)),
    ]
    avg_brightness = sum(sum(c) / 3 for c in corners) / len(corners)
    return avg_brightness > 200


def threshold_remove_bg(img):
    img = img.convert('RGBA')
    data = np.array(img)

    r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]
    brightness = (r.astype(int) + g.astype(int) + b.astype(int)) / 3

    # Light pixels → transparent, dark pixels → opaque
    data[:,:,3] = np.where(brightness > 200, 0, 255).astype(np.uint8)

    # Semi-dark pixels (128–200) → semi-transparent
    mask = (brightness >= 128) & (brightness <= 200)
    data[:,:,3][mask] = ((200 - brightness[mask]) / 72 * 255).astype(np.uint8)

    return Image.fromarray(data)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok'})


@app.route('/remove-bg', methods=['POST'])
def remove_bg():
    try:
        data = request.get_json()
        image_b64 = data.get('image')

        if ',' in image_b64:
            image_b64 = image_b64.split(',')[1]
        image_bytes = base64.b64decode(image_b64)

        input_image = Image.open(io.BytesIO(image_bytes))

        if is_light_background(input_image):
            # Fast threshold method for black ink on white/light background
            output_image = threshold_remove_bg(input_image)
        else:
            # AI method for complex backgrounds (photos, skin, etc.)
            from rembg import remove
            output_image = remove(input_image)

        output_buffer = io.BytesIO()
        output_image.save(output_buffer, format='PNG')
        output_b64 = base64.b64encode(
            output_buffer.getvalue()
        ).decode('utf-8')

        return jsonify({
            'image': 'data:image/png;base64,' + output_b64
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    print(f'Background removal server running on port {port}')
    app.run(host='0.0.0.0', port=port, debug=False)
