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

        // 1. Convertir Base64 a Buffer
        const base64Data = ocrBase64.replace(/^data:image\/\w+;base64,/, "");
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // 2. OCR con Google Cloud Vision
        const [result] = await client.textDetection(imageBuffer);
        const text = result.fullTextAnnotation ? result.fullTextAnnotation.text : "";
        
        // 3. Separar el texto línea por línea y limpiarlo
        const lineas = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l !== '');

        // --- INICIO DE LA FASE 2: EXTRACCIÓN AVANZADA ---
        
        // A. Extraer Cédula (Mantenemos el filtro infalible)
        const soloNumeros = text.replace(/\D/g, ''); 
        const match = soloNumeros.match(/\d{7,11}/);
        const cedulaExtraida = match ? match[0] : "No detectada";

        // B. Extraer Apellidos (Buscamos la palabra APELLIDOS y tomamos la línea anterior)
        let apellidosExtraidos = "No detectados";
        const idxApellidos = lineas.findIndex(l => l === 'APELLIDOS');
        if (idxApellidos > 0) {
            apellidosExtraidos = lineas[idxApellidos - 1]; // Toma la línea de arriba
        }

        // C. Extraer Nombres (Buscamos la palabra NOMBRES y tomamos la línea anterior)
        let nombresExtraidos = "No detectados";
        const idxNombres = lineas.findIndex(l => l === 'NOMBRES');
        if (idxNombres > 0) {
            nombresExtraidos = lineas[idxNombres - 1]; // Toma la línea de arriba
        }

        // 4. Respuesta enriquecida para Genesys
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




