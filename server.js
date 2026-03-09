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

        // --- INICIO FASE 2.5: FILTRO DE CALIDAD "NINJA" ---
        // Filtro de Tamaño Físico (Rechaza si pesa menos de 40 KB)
        const sizeInKB = imageBuffer.length / 1024;
        if (sizeInKB < 40) {
            console.log("⚠️ Imagen rechazada por tamaño miniatura:", sizeInKB.toFixed(2), "KB");
            return res.json({ 
                calidadAprobada: false, 
                mensajeRechazo: "La imagen es muy pequeña o es una miniatura. Por favor, toma la foto más de cerca." 
            });
        }

        // Ejecutar Google Cloud Vision
        const [result] = await client.textDetection(imageBuffer);
        
        // Filtro de Claridad (Confidence Score de Google)
        let confidence = 0;
        if (result.fullTextAnnotation && result.fullTextAnnotation.pages.length > 0) {
            confidence = result.fullTextAnnotation.pages[0].confidence || 0; 
        }

        // Si Google está menos del 80% (0.80) seguro, significa que está borrosa
        if (confidence > 0 && confidence < 0.80) {
             console.log("⚠️ Imagen rechazada por baja calidad/borrosa. Score:", confidence);
             return res.json({ 
                calidadAprobada: false, 
                mensajeRechazo: "La foto está borrosa o tiene reflejos de luz. Por favor, tómala de nuevo." 
            });
        }
        // --- FIN FASE 2.5 ---

        // 3. Separar el texto línea por línea y limpiarlo
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        const lineas = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== '');

        // --- FASE 2: EXTRACCIÓN AVANZADA ---
        
        // A. Extraer Cédula
        const soloNumeros = text.replace(/\D/g, ''); 
        const match = soloNumeros.match(/\d{7,11}/);
        const cedulaExtraida = match ? match[0] : "No detectada";

        // B. Extraer Apellidos 
        let apellidosExtraidos = "No detectados";
        const idxApellidos = lineas.findIndex(l => l.includes('APELLIDO'));
        if (idxApellidos > 0) {
            apellidosExtraidos = lineas[idxApellidos - 1]; 
        }

        // C. Extraer Nombres
        let nombresExtraidos = "No detectados";
        const idxNombres = lineas.findIndex(l => l.includes('NOMBRE'));
        if (idxNombres > 0) {
            nombresExtraidos = lineas[idxNombres - 1];
        }

        // 4. Preparamos y enviamos la respuesta
        const respuestaFinal = {
            calidadAprobada: true,
            cedula: cedulaExtraida,
            nombres: nombresExtraidos,
            apellidos: apellidosExtraidos
        };

        console.log("=== ENVIANDO A GENESYS ===");
        console.log(respuestaFinal);

        res.json(respuestaFinal);

    } catch (error) {
        console.error("Error en OCR:", error);
        res.status(500).json({ error: error.message });
    }
});

// Arrancar el servidor (¡Esta es la parte que le faltaba a Render!)
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor OCR de Google listo en puerto ${PORT}`);
});
