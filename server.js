const express = require('express');
const vision = require('@google-cloud/vision');
const app = express();

// Genesys envía Base64 largos, permitimos hasta 10MB
app.use(express.json({ limit: '10mb' }));

// 1. Configuración de Google Vision con tu JSON del archivo project-bd5c4921...
let client;
// Cambia tu bloque de configuración por este para investigar el error:
try {
    const rawCreds = process.env.GOOGLE_CREDENTIALS;
    console.log("Contenido de la variable:", rawCreds ? "Recibida (OK)" : "VACÍA (UNDEFINED)");
    const credentials = JSON.parse(rawCreds);
    client = new vision.ImageAnnotatorClient({ credentials });
    console.log("✅ Conectado a Google Cloud Vision: " + credentials.project_id);
} catch (error) {
    console.error("❌ Error detallado:", error.message);
}

app.post('/api/extract', async (req, res) => {
    try {
        const { ocrBase64 } = req.body;

        if (!ocrBase64) {
            return res.status(400).json({ error: "Falta el campo ocrBase64" });
        }

        // 2. Convertir Base64 a Buffer (Sin Sharp, Google lo hace mejor)
        const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // 3. OCR con Google Cloud Vision (Súper rápido y no consume tu RAM)
        const [result] = await client.textDetection(imageBuffer);
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        console.log("=== TEXTO CRUDO DE GOOGLE ===");
        console.log(text);
        console.log("=============================");
        
        // 4. Limpiar y buscar la cédula (7 a 11 dígitos)
        const soloNumeros = text.replace(/\D/g, ''); 
        const match = soloNumeros.match(/\d{7,11}/);

        // Respuesta limpia para Genesys
        res.json({
            cedula: match ? match[0] : "No detectada"
        });

    } catch (error) {
        console.error("Error en OCR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Usamos el puerto 10000 para Render como vimos en tus logs
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor OCR de Google listo en puerto ${PORT}`);
});



