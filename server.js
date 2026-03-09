const express = require('express');
const vision = require('@google-cloud/vision');
const app = express();

// Genesys envía Base64 largos, permitimos hasta 10MB
app.use(express.json({ limit: '10mb' }));

// 1. Configuración de Google Vision con tu JSON de variables de entorno
let client;
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

        // 2. Convertir Base64 a Buffer
        const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // 3. OCR con Google Cloud Vision
        const [result] = await client.textDetection(imageBuffer);
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        
        console.log("=== TEXTO CRUDO DE GOOGLE ===");
        console.log(text);
        console.log("=============================");

        // 4. Separar el texto línea por línea y limpiarlo
        const lineas = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== '');

        // --- FASE 2: EXTRACCIÓN AVANZADA ---
        
        // A. Extraer Cédula
        const soloNumeros = text.replace(/\D/g, ''); 
        const match = soloNumeros.match(/\d{7,11}/);
        const cedulaExtraida = match ? match[0] : "No detectada";

        // B. Extraer Apellidos (Línea anterior a "APELLIDOS")
        let apellidosExtraidos = "No detectados";
        const idxApellidos = lineas.findIndex(l => l === 'APELLIDOS');
        if (idxApellidos > 0) {
            apellidosExtraidos = lineas[idxApellidos - 1]; 
        }

        // C. Extraer Nombres (Línea anterior a "NOMBRES")
        let nombresExtraidos = "No detectados";
        const idxNombres = lineas.findIndex(l => l === 'NOMBRES');
        if (idxNombres > 0) {
            nombresExtraidos = lineas[idxNombres - 1];
        }

        // 5. Respuesta enriquecida para Genesys
        res.json({
            cedula: cedulaExtraida,
            nombres: nombresExtraidos,
            apellidos: apellidosExtraidos
        });

    } catch (error) {
        console.error("Error en OCR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Arrancar el servidor
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor OCR de Google listo en puerto ${PORT}`);
});
