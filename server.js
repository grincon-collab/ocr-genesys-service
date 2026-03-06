const express = require('express');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const app = express();

// Genesys envía Base64 largos, permitimos hasta 10MB
app.use(express.json({ limit: '10mb' }));

app.post('/api/extract', async (req, res) => {
    try {
        const { ocrBase64 } = req.body;

        if (!ocrBase64) {
            return res.status(400).json({ error: "Falta el campo ocrBase64" });
        }

        // 1. Convertir Base64 a Buffer
        const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // 2. Procesar con Sharp (Configuración V1)
        const optimizedBuffer = await sharp(imageBuffer)
            .rotate()
            .resize(2200)
            .grayscale()
            .modulate({ brightness: 1.2, contrast: 1.8 })
            .sharpen()
            .toBuffer();

        // 3. OCR con Tesseract
        const { data: { text } } = await Tesseract.recognize(optimizedBuffer, 'spa');
        
        const textoLimpio = text.replace(/\s+/g, ' ').toUpperCase();
        const cedulaMatch = textoLimpio.match(/\d{7,11}/);

        // 4. Respuesta para Genesys
        res.json({
            cedula: cedulaMatch ? cedulaMatch[0] : "No detectada"
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));