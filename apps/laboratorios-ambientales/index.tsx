
import { GoogleGenAI } from "@google/genai";
import { marked } from "marked";
import DOMPurify from "dompurify";

document.addEventListener('DOMContentLoaded', () => {
    // --- INTERFACE DEFINITION ---
    interface RowData {
        codigo: string;
        estado: string;
        matriz: string;
        componente: string;
        actividad: string;
        grupo: string;
        variable: string;
        tecnica: string;
        metodo: string;
        intervalo: string;
        nombreEstacion: string;
        direccionEstacion: string;
        latitud: string;
        longitud: string;
        idEquipo: string;
        nombreLab: string;
        nit: string;
        contacto: string;
        ciudad: string;
        departamento: string;
        direccion: string;
        telefono: string;
        correo: string;
        actoAdministrativo: string;
        desde: string;
        hasta: string;
        [key: string]: string; // Allow other keys for flexibility
    }

    // --- VARIABLES GLOBALES Y ELEMENTOS DEL DOM ---
    let fullData: RowData[] = [];
    let selectedVariables: string[] = [];
    const DATASET_ID = '2waz-acaa';
    const SODA_URL = `https://www.datos.gov.co/resource/${DATASET_ID}.json`;

    const mainPage = document.getElementById('main-page') as HTMLElement;
    const buscadorPage = document.getElementById('buscador-page') as HTMLElement;
    const dashboardPage = document.getElementById('dashboard-page') as HTMLElement;
    const analisisPage = document.getElementById('analisis-page') as HTMLElement;
    
    const goToBuscadorBtn = document.getElementById('goToBuscador') as HTMLButtonElement;
    const goToDashboardBtn = document.getElementById('goToDashboard') as HTMLButtonElement;
    const goToAnalisisBtn = document.getElementById('goToAnalisis') as HTMLButtonElement;
    const goToMainFromBuscadorBtn = document.getElementById('goToMainFromBuscador') as HTMLButtonElement;
    const goToMainFromDashboardBtn = document.getElementById('goToMainFromDashboard') as HTMLButtonElement;
    const goToMainFromAnalisisBtn = document.getElementById('goToMainFromAnalisis') as HTMLButtonElement;
    
    const loadingStatus = document.getElementById('loading-status') as HTMLElement;
    const mainLoader = document.getElementById('main-loader') as HTMLElement;
    const mainSubtitle = document.getElementById('main-subtitle') as HTMLElement;


    // Buscador elements
    const searchInput = document.getElementById('search-lab') as HTMLInputElement;
    const estadoFilter = document.getElementById('filter-estado') as HTMLSelectElement;
    const matrizFilter = document.getElementById('filter-matriz') as HTMLSelectElement;
    const componenteFilter = document.getElementById('filter-componente') as HTMLSelectElement;
    const actividadFilter = document.getElementById('filter-actividad') as HTMLSelectElement;
    const metodoFilter = document.getElementById('filter-metodo') as HTMLSelectElement;
    const clearButton = document.getElementById('clear-filters') as HTMLButtonElement;
    const variableButton = document.getElementById('variable-multiselect-button') as HTMLButtonElement;
    const variablePanel = document.getElementById('variable-multiselect-panel') as HTMLElement;
    const variableList = document.getElementById('variable-multiselect-list') as HTMLElement;
    const variableSearch = document.getElementById('variable-search') as HTMLInputElement;
    const resultsContainer = document.getElementById('results-container') as HTMLElement;
    const resultsSummary = document.getElementById('results-summary') as HTMLElement;
    const noResultsDiv = document.getElementById('no-results') as HTMLElement;
    const statusContainer = document.getElementById('status-container') as HTMLElement;
    
    // Dashboard elements
    const dashboardResultsContainer = document.getElementById('dashboard-results-container') as HTMLElement;
    const brandFilter = document.getElementById('filter-brand') as HTMLSelectElement;
    const modelFilter = document.getElementById('filter-model') as HTMLSelectElement;
    const clearDashboardFiltersBtn = document.getElementById('clear-dashboard-filters') as HTMLButtonElement;
    const dashboardSummary = document.getElementById('dashboard-summary') as HTMLElement;

    // AI Analysis elements
    const aiPromptInput = document.getElementById('ai-prompt') as HTMLTextAreaElement;
    const submitAiPromptBtn = document.getElementById('submit-ai-prompt') as HTMLButtonElement;
    const aiLoader = document.getElementById('ai-loader') as HTMLElement;
    const aiResponseContainer = document.getElementById('ai-response-container') as HTMLElement;
    const aiResponseEl = document.getElementById('ai-response') as HTMLElement;

    // --- NAVEGACIÓN ENTRE PÁGINAS ---
    function showPage(pageToShow: HTMLElement) {
        [mainPage, buscadorPage, dashboardPage, analisisPage].forEach(page => {
            page.classList.toggle('hidden', page !== pageToShow);
        });
    }

    goToBuscadorBtn.addEventListener('click', () => showPage(buscadorPage));
    goToDashboardBtn.addEventListener('click', () => {
        showPage(dashboardPage);
        populateBrandFilter();
        generateDashboardData(); 
    });
    goToAnalisisBtn.addEventListener('click', () => showPage(analisisPage));
    goToMainFromBuscadorBtn.addEventListener('click', () => showPage(mainPage));
    goToMainFromDashboardBtn.addEventListener('click', () => showPage(mainPage));
    goToMainFromAnalisisBtn.addEventListener('click', () => showPage(mainPage));


    // --- LÓGICA DE CARGA DE DATOS ---
    
    // Función de ayuda para fetch con proxies de respaldo
    async function fetchWithFallback(url: string) {
        // Intento 1: Directo (algunos servidores permiten CORS si se configuran bien)
        try {
            const resp = await fetch(url);
            if (resp.ok) return await resp.json();
        } catch (e) {
            console.warn("Conexión directa fallida, intentando proxy 1...");
        }

        // Intento 2: AllOrigins (muy estable)
        try {
            const proxiedUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
            const resp = await fetch(proxiedUrl);
            if (resp.ok) return await resp.json();
        } catch (e) {
            console.warn("Proxy 1 fallido, intentando proxy 2...");
        }

        // Intento 3: CorsProxy.io
        const proxiedUrl2 = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        const resp = await fetch(proxiedUrl2);
        if (!resp.ok) throw new Error(`Error en la red: ${resp.status} ${resp.statusText}`);
        return await resp.json();
    }

    async function loadDataFromSource() {
        fullData = [];
        loadingStatus.classList.remove('text-red-600');
        loadingStatus.textContent = "Iniciando descarga de datos...";
        mainLoader.classList.remove('hidden');
        
        try {
            const LIMIT = 5000;
            let offset = 0;
            let hasMore = true;

            // Primero intentamos obtener el conteo total para informar al usuario
            const countUrl = `${SODA_URL}?$select=count(*)`;
            let totalRecords = 0;
            try {
                const countData = await fetchWithFallback(countUrl);
                totalRecords = parseInt(countData[0].count);
            } catch (e) {
                console.warn("No se pudo obtener el conteo exacto.");
            }

            while (hasMore) {
                const paginatedUrl = `${SODA_URL}?$limit=${LIMIT}&$offset=${offset}`;
                const records = await fetchWithFallback(paginatedUrl);
                
                if (records.length === 0) {
                    hasMore = false;
                    break;
                }

                const processedRecords = records.map(transformRecord);
                fullData.push(...processedRecords);

                const progress = totalRecords > 0 
                    ? `Cargando: ${fullData.length} de aprox. ${totalRecords} registros...` 
                    : `Cargando registros... (${fullData.length} descargados)`;
                
                loadingStatus.textContent = progress;
                offset += LIMIT;

                if (records.length < LIMIT) hasMore = false;
            }
            
            mainLoader.classList.add('hidden');
            loadingStatus.textContent = `¡Datos cargados! ${fullData.length} registros procesados.`;
            mainSubtitle.textContent = '¡Plataforma lista! Seleccione una herramienta para comenzar.';
            [goToBuscadorBtn, goToDashboardBtn, goToAnalisisBtn].forEach(btn => {
                btn.disabled = false;
                btn.classList.remove('bg-gray-400', 'cursor-not-allowed');
                btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
            });
            
            populateFilters();
            resetBuscador();

        } catch (error) {
            console.error("Error al cargar datos:", error);
            const message = error instanceof Error ? error.message : String(error);
            loadingStatus.innerHTML = `
                <div class="flex flex-col items-center gap-4">
                    <span class="text-red-600 font-semibold">Error al conectar con la fuente de datos: ${message}</span>
                    <button id="retry-connection" class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors">Reintentar Conexión</button>
                </div>
            `;
            const retryBtn = document.getElementById('retry-connection');
            if (retryBtn) retryBtn.addEventListener('click', loadDataFromSource);
            mainLoader.classList.add('hidden');
        }
    }

    function transformRecord(record: any): RowData {
        // En SODA JSON los nombres de los campos suelen coincidir con los de OData
        const mapping: { [key: string]: keyof RowData } = {
            'c_digo_de_laboratorio': 'codigo', 
            'estado_de_la_acreditaci_n': 'estado', 
            'matriz': 'matriz', 
            'componente': 'componente', 
            'actividad': 'actividad', 
            'grupo': 'grupo', 
            'variable': 'variable', 
            't_cnica': 'tecnica', 
            'm_todo': 'metodo', 
            'intervalo_de_medici_n_directa': 'intervalo', 
            'nombre_de_la_estaci_n': 'nombreEstacion', 
            'direcci_n_de_la_estaci_n': 'direccionEstacion', 
            'latitud': 'latitud', 
            'longitud': 'longitud', 
            'identificaci_n_de_equipo': 'idEquipo', 
            'nombre_del_laboratorio': 'nombreLab', 
            'nit': 'nit', 
            'contacto': 'contacto', 
            'ciudad': 'ciudad', 
            'departamento': 'departamento', 
            'direcci_n': 'direccion', 
            'tel_fono': 'telefono', 
            'correo': 'correo', 
            'actos_administrativos_que': 'actoAdministrativo', 
            'desde': 'desde', 
            'hasta': 'hasta'
        };

        const rowObject: Partial<RowData> = {};
        for (const apiKey in mapping) {
            const appKey = mapping[apiKey];
            rowObject[appKey] = record[apiKey] || '';
        }

        rowObject.estado = normalizeEstado(rowObject.estado || '');
        rowObject.matriz = normalizeMatriz(rowObject.matriz || '');
        rowObject.componente = normalizeComponente(rowObject.componente || '');
        rowObject.actividad = normalizeActividad(rowObject.actividad || '');
        rowObject.variable = normalizeVariable(rowObject.variable || '');
        rowObject.nombreLab = record.nombre_del_laboratorio || '';

        return rowObject as RowData;
    }


    // --- LÓGICA DE ANÁLISIS CON IA ---
    async function handleAiAnalysis() {
        const userPrompt = aiPromptInput.value.trim();
        if (!userPrompt || fullData.length === 0) {
            aiResponseEl.textContent = "Por favor, escribe una pregunta y asegúrate de que los datos estén cargados.";
            aiResponseContainer.classList.remove('hidden');
            return;
        }

        aiLoader.classList.remove('hidden');
        aiResponseContainer.classList.add('hidden');
        submitAiPromptBtn.disabled = true;

        try {
            const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});

            const dataSummary = `El dataset contiene ${fullData.length} registros. 
            Las columnas disponibles son: ${Object.keys(fullData[0]).join(', ')}.
            Ejemplos de matriz: ${[...new Set(fullData.slice(0, 500).map(d => d.matriz).filter(Boolean))].slice(0,5).join(', ')}.
            `;

            const systemInstruction = `Eres un asistente experto en análisis de datos ambientales.
            Tu tarea es generar un código JavaScript (dentro de un bloque \`\`\`javascript) que sea ejecutado sobre un array de objetos llamado 'fullData' para responder a la pregunta del usuario.
            El código debe terminar con una sentencia 'return' que devuelva el resultado final.
            Proporciona solo el bloque de código JavaScript.
            Usa el modelo 'gemini-3-pro-preview' para tareas complejas.`;

            const promptForCodeGeneration = `${dataSummary}\n\nPregunta del usuario: "${userPrompt}"\n\nGenera el código JavaScript para responder esta pregunta.`;
            
            const codeGenResponse = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: promptForCodeGeneration,
                config: { systemInstruction, temperature: 0.0 }
            });

            let generatedCode = codeGenResponse.text || "";
            generatedCode = generatedCode.replace(/^```javascript\s*|```\s*$/g, '').trim();

            if (!generatedCode) {
                throw new Error("La IA no pudo generar un código de análisis válido.");
            }

            const analysisFunction = new Function('fullData', generatedCode);
            const analysisResult = analysisFunction(fullData);

            const summarizationSystemInstruction = `Eres un asistente amigable. Resume el resultado JSON del análisis de datos de manera clara en español usando markdown.`;

            const summarizationPrompt = `Pregunta: "${userPrompt}"\n\nResultado: ${JSON.stringify(analysisResult)}\n\nResume esto de forma clara.`;
            
            const summaryResponse = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: summarizationPrompt,
                config: { systemInstruction: summarizationSystemInstruction }
            });

            // SEC-004 — sanea la salida del modelo antes de inyectarla como HTML.
            aiResponseEl.innerHTML = DOMPurify.sanitize(marked.parse(summaryResponse.text || "") as string);

        } catch (error) {
            console.error("Error en el análisis con IA:", error);
            const message = error instanceof Error ? error.message : String(error);
            aiResponseEl.textContent = `Ocurrió un error al intentar analizar los datos. Por favor, intenta reformular tu pregunta. \n\nDetalles: ${message}`;
        } finally {
            aiLoader.classList.add('hidden');
            aiResponseContainer.classList.remove('hidden');
            submitAiPromptBtn.disabled = false;
        }
    }


    // --- LÓGICA DEL DASHBOARD ---
    const equipmentMap: { [key: string]: { brand: string; model: string; pollutant: string } } = {
        'EQPM-0798-122': { brand: 'Met One Instruments, Inc.', model: 'BAM 1020', pollutant: 'Partículas' },
        'EQPM-0308-170': { brand: 'Teledyne API', model: '602 BetaPlus', pollutant: 'Partículas' },
        'EQSA-0495-100': { brand: 'Teledyne API', model: '100 Series', pollutant: 'SO₂' },
        'EQSA-0507-166': { brand: 'SIR S.A.', model: 'S-5001', pollutant: 'SO₂' },
        'RFNA-1194-099': { brand: 'Teledyne API', model: '200E / T200 / N200 Series', pollutant: 'NOx' },
        'RFNA-0804-152': { brand: 'SIR S.A.', model: 'S-5012', pollutant: 'NOx' },
        'RFCA-0708-172': { brand: 'SIR S.A.', model: 'S-5006', pollutant: 'CO' },
        'RFCA-1093-093': { brand: 'Teledyne API', model: '300 Series', pollutant: 'CO' },
        'EQOA-0992-087': { brand: 'Teledyne API', model: '400 Series', pollutant: 'O₃' },
        'EQOA-0207-164': { brand: 'SIR S.A.', model: 'S-5014', pollutant: 'O₃' },
        'EQSA-0506-159': { brand: 'Horiba', model: 'APSA-370', pollutant: 'SO₂' },
        'EQOA-0506-160': { brand: 'Horiba', model: 'APOA-370', pollutant: 'O₃' },
        'RFCA-0506-158': { brand: 'Horiba', model: 'APMA-370', pollutant: 'CO' },
        'RFNA-0506-157': { brand: 'Horiba', model: 'APNA-370', pollutant: 'NOx' },
        'RFNA-1289-074': { brand: 'Thermo Environmental', model: '42i / 42iQ Series', pollutant: 'NOx' },
        'EQSA-0990-077': { brand: 'Advanced Pollution Instrumentation', model: '100', pollutant: 'SO₂' },
        'RFSA-1219-255': { brand: 'Focused Photonics Inc.', model: 'AQMS-500', pollutant: 'SO₂' },
        'EQOA-0719-253': { brand: 'Focused Photonics Inc.', model: 'AQMS-300 / 300M', pollutant: 'O₃' },
        'RFCA-0419-252': { brand: 'Focused Photonics Inc.', model: 'AQMS-400 / 400M', pollutant: 'CO' },
        'RFNA-0819-254': { brand: 'Focused Photonics Inc.', model: 'AQMS-600', pollutant: 'NOx' },
        'EQNA-0217-243': { brand: '2B Technologies', model: '405 nm', pollutant: 'NO₂' },
        'EQNA-0512-200': { brand: 'Teledyne API', model: '200EUP / T200UP', pollutant: 'NO₂' },
        'EQNA-1016-241': { brand: 'Teledyne API', model: 'T200P', pollutant: 'NO₂' },
        'EQNA-0514-212': { brand: 'Teledyne API', model: 'T500U', pollutant: 'NO₂' },
        'EQNA-0320-256': { brand: 'Teledyne API', model: 'N500', pollutant: 'NO₂' },
        'EQSA-0486-060': { brand: 'Thermo Scientific', model: '43i / 43iQ Series', pollutant: 'SO₂' },
        'EQOA-0880-047': { brand: 'Thermo Scientific', model: '49i / 49iQ Series', pollutant: 'O₃' },
        'RFCA-0981-054': { brand: 'Thermo Scientific', model: '48i / 48iQ Series', pollutant: 'CO' },
        'RFNA-0809-186': { brand: 'Ecotech / Acoem', model: 'Serinus 40 / 44', pollutant: 'NOx' },
        'EQSA-0809-188': { brand: 'Ecotech / Acoem', model: 'Serinus 50', pollutant: 'SO₂' },
        'EQOA-0809-187': { brand: 'Ecotech / Acoem', model: 'Serinus 10', pollutant: 'O₃' },
        'RFCA-0509-174': { brand: 'Ecotech / Acoem', model: 'Serinus 30', pollutant: 'CO' },
        'EQNA-0217-242': { brand: 'Ecotech / Acoem', model: 'Serinus 60', pollutant: 'NO₂' },
        'UNE-EN 16450': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
        'UNE EN 16450': { brand: 'Grimm', model: 'EDM180', pollutant: 'Partículas' },
        'EQPM-0121-258': { brand: 'Focused Photonics Inc.', model: 'BPM-200 PM10 Monitor', pollutant: 'Partículas' },
        'RFSA-0616-237': { brand: 'Thermo Scientific', model: '43i-TLE SO2 Analyzer', pollutant: 'SO₂' },
        'RFSA-1120-257': { brand: 'KENTEK Inc.', model: 'MEZUS 110 SO2 Analyzer', pollutant: 'SO₂' },
        'EQPM-0923-262': { brand: 'Vasthi Instruments', model: 'PM Monitor', pollutant: 'Partículas' },
        'EQOA-0219-251': { brand: 'KENTEK Inc.', model: 'MEZUS 410 O3 Analyzer', pollutant: 'O₃' },
        'RFNA-1221-259': { brand: 'KENTEK Inc.', model: 'MEZUS 210 NO₂ Analyzer', pollutant: 'NO₂' },
        'RFCA-0317-244': { brand: 'KENTEK Inc.', model: 'MEZUS 310 CO Analyzer', pollutant: 'CO' },
        'EQOA-0415-222': { brand: 'Sabio', model: '6030 Ozone Analyzer', pollutant: 'O₃' },
        'RFCA-0817-248': { brand: 'Sabio', model: '6050 CO Analyzer', pollutant: 'CO' },
        'EQPM-1013-209': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' },
        'EQPM-0715-266': { brand: 'Met One Instruments, Inc.', model: 'BAM-1022', pollutant: 'Partículas' }
    };

    function populateBrandFilter() {
        const brands = [...new Set(Object.values(equipmentMap).map(e => e.brand))].sort();
        brandFilter.innerHTML = '<option value="">Todas las Marcas</option>';
        brands.forEach(brand => {
            const option = document.createElement('option');
            option.value = brand;
            option.textContent = brand;
            brandFilter.appendChild(option);
        });
    }

    function updateModelFilter() {
        const selectedBrand = brandFilter.value;
        modelFilter.innerHTML = '<option value="">Todos los Modelos</option>';
        if (selectedBrand) {
            const models = [...new Set(Object.values(equipmentMap)
                .filter(e => e.brand === selectedBrand)
                .map(e => e.model))]
                .sort();
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model;
                option.textContent = model;
                modelFilter.appendChild(option);
            });
            modelFilter.disabled = false;
        } else {
            modelFilter.disabled = true;
        }
    }

    function extractAndMapEquipment(methodString: string) {
        if (!methodString) return null;
        const sortedCodes = Object.keys(equipmentMap).sort((a, b) => b.length - a.length);
        for (const code of sortedCodes) {
            if (methodString.includes(code)) {
                return { code, ...equipmentMap[code] };
            }
        }
        return null;
    }

    function generateDashboardData() {
        const selectedBrand = brandFilter.value;
        const selectedModel = modelFilter.value;

        const filteredData = fullData.filter(item => 
            item.estado === 'Activa' &&
            item.matriz === 'Aire' &&
            item.componente === 'Calidad de aire'
        );

        const labs = filteredData.reduce((acc, item) => {
            const labName = item.nombreLab;
            if (!labName) return acc;
            const equipmentInfo = extractAndMapEquipment(item.metodo);
            if (equipmentInfo) {
                const brandMatch = !selectedBrand || equipmentInfo.brand === selectedBrand;
                const modelMatch = !selectedModel || equipmentInfo.model === selectedModel;
                if (brandMatch && modelMatch) {
                    if (!acc[labName]) {
                        acc[labName] = {
                            details: { contacto: item.contacto, correo: item.correo, telefono: item.telefono, ciudad: item.ciudad },
                            equipment: []
                        };
                    }
                    if (!acc[labName].equipment.some((e: any) => e.metodo === item.metodo)) {
                         acc[labName].equipment.push({ 
                            metodo: item.metodo, 
                            estado: item.estado,
                            matriz: item.matriz,
                            ...equipmentInfo 
                        });
                    }
                }
            }
            return acc;
        }, {} as any);
        displayDashboardResults(labs);
    }

    function displayDashboardResults(labsData: any) {
        dashboardResultsContainer.innerHTML = '';
        const labNames = Object.keys(labsData);
        dashboardSummary.textContent = `${labNames.length} laboratorios encontrados.`;
        if (labNames.length === 0) {
            dashboardResultsContainer.innerHTML = `<div class="text-center py-10 bg-white rounded-lg shadow-md"><h3 class="mt-2 text-xl font-medium text-gray-900">No se encontraron equipos</h3></div>`;
            return;
        }
        labNames.sort().forEach(labName => {
            const lab = labsData[labName];
            const card = document.createElement('div');
            card.className = 'bg-white p-5 rounded-lg shadow-sm border border-gray-200';
            card.innerHTML = `
                <div class="mb-4">
                    <h3 class="text-lg font-bold text-indigo-700">${labName}</h3>
                    <p class="text-sm text-gray-500">${lab.details.ciudad || ''}</p>
                </div>
                <div class="overflow-x-auto">
                    <table class="min-w-full text-sm text-left border-collapse">
                        <thead class="bg-gray-50"><tr><th class="px-3 py-2">Marca</th><th class="px-3 py-2">Modelo</th><th class="px-3 py-2">Contaminante</th></tr></thead>
                        <tbody>${lab.equipment.map((eq: any) => `<tr><td class="px-3 py-2">${eq.brand}</td><td class="px-3 py-2">${eq.model}</td><td class="px-3 py-2 font-medium">${eq.pollutant}</td></tr>`).join('')}</tbody>
                    </table>
                </div>`;
            dashboardResultsContainer.appendChild(card);
        });
    }

    // --- LÓGICA DEL BUSCADOR ---
    function resetBuscador(){
        selectedVariables = [];
        searchInput.value = "";
        [estadoFilter, matrizFilter, componenteFilter, actividadFilter, metodoFilter].forEach(e => { e.value = "" });
        updateDependentFilters();
    }
    
    function normalizeMatriz(e: string) {
        if (!e) return "";
        const t = e.toLowerCase().trim();
        if (t.includes("residuos peligrosos")) return "Residuos Peligrosos (RESPEL)";
        if (t.includes("agua")) return "Agua";
        if (t.includes("aire")) return "Aire";
        if (t.includes("suelo")) return "Suelo";
        return e.trim();
    }

    function normalizeComponente(e: string) {
        if (!e) return "";
        const t = e.toLowerCase().trim();
        if (t.includes("calidad de aire")) return "Calidad de aire";
        if (t.includes("fuentes fijas")) return "Fuentes Fijas";
        return e.trim();
    }

    function normalizeActividad(e: string): string {
        if (!e) return "";
        return e.trim().toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
    }

    function normalizeVariable(variableName: string): string {
        if (!variableName) return "";
        return variableName.trim();
    }

    function normalizeEstado(e: string) {
        if (!e) return "";
        const t = e.toLowerCase().trim();
        return t === "activa" ? "Activa" : t === "suspendida" ? "Suspendida" : "";
    }
    
    function populateFilters() {
        const estados = new Set<string>();
        const matrices = new Set<string>();
        fullData.forEach(item => {
            if (item.estado) estados.add(item.estado);
            if (item.matriz) matrices.add(item.matriz);
        });

        const populateSelect = (selectElement: HTMLSelectElement, options: Set<string>) => {
            const currentVal = selectElement.value;
            const sortedOptions = [...options].sort();
            selectElement.innerHTML = '<option value="">Todos</option>';
            sortedOptions.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                selectElement.appendChild(option);
            });
            selectElement.value = currentVal;
        };

        populateSelect(estadoFilter, estados);
        populateSelect(matrizFilter, matrices);
        updateDependentFilters();
    }

    function updateDependentFilters(changedFilter: keyof RowData | "" = "") {
        const filterOrder: (keyof RowData)[] = ["matriz", "componente", "actividad", "variable", "metodo"];
        const changedIndex = filterOrder.indexOf(changedFilter as keyof RowData);
        for (let i = changedIndex + 1; i < filterOrder.length; i++) {
            const filterToUpdate = filterOrder[i];
            switch (filterToUpdate) {
                case "componente": updateDynamicSelect(componenteFilter, "componente", [matrizFilter]); break;
                case "actividad": updateDynamicSelect(actividadFilter, "actividad", [matrizFilter, componenteFilter]); break;
                case "variable": updateDynamicMultiSelect(variableList, "variable", [matrizFilter, componenteFilter, actividadFilter]); break;
                case "metodo": updateDynamicSelect(metodoFilter, "metodo", [matrizFilter, componenteFilter, actividadFilter], true); break;
            }
        }
        applyFilters();
    }

    function updateDynamicSelect(selectElement: HTMLSelectElement, field: keyof RowData, dependentFilters: HTMLSelectElement[], useSelectedVars = false) {
        const currentValue = selectElement.value;
        selectElement.innerHTML = '<option value="">Todos</option>';
        let filtered = fullData;
        dependentFilters.forEach(depFilter => {
            if (depFilter.value) {
                const filterKey = depFilter.id.split('-')[1] as keyof RowData;
                filtered = filtered.filter(item => item[filterKey] === depFilter.value);
            }
        });
        if (useSelectedVars && selectedVariables.length > 0) {
            filtered = filtered.filter(item => selectedVariables.includes(item.variable));
        }
        const options = new Set<string>();
        filtered.forEach(item => { if (item[field]) options.add(item[field]); });
        [...options].sort().forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            selectElement.appendChild(option);
        });
        if ([...selectElement.options].some(opt => opt.value === currentValue)) selectElement.value = currentValue;
    }

    function updateDynamicMultiSelect(listElement: HTMLElement, field: keyof RowData, dependentFilters: HTMLSelectElement[]) {
        const searchTerm = variableSearch.value.toLowerCase();
        listElement.innerHTML = "";
        let filtered = fullData;
        dependentFilters.forEach(depFilter => {
            if (depFilter.value) {
                 const filterKey = depFilter.id.split('-')[1] as keyof RowData;
                filtered = filtered.filter(item => item[filterKey] === depFilter.value);
            }
        });
        const options = new Set<string>();
        filtered.forEach(item => { if (item[field]) options.add(item[field]); });
        const finalOptions = [...options].sort().filter(opt => opt.toLowerCase().includes(searchTerm));
        finalOptions.forEach(opt => {
            const isChecked = selectedVariables.includes(opt);
            const label = document.createElement('label');
            label.className = "flex items-center p-2 hover:bg-gray-100 cursor-pointer";
            label.innerHTML = `<input type="checkbox" class="h-4 w-4 rounded border-gray-300 text-indigo-600 variable-item" ${isChecked ? "checked" : ""} value="${opt}"><span class="ml-2 text-sm text-gray-700">${opt}</span>`;
            label.querySelector('input')!.addEventListener('change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.checked) { if (!selectedVariables.includes(opt)) selectedVariables.push(opt); }
                else { selectedVariables = selectedVariables.filter(v => v !== opt); }
                updateVariableButtonText();
                updateDependentFilters('variable');
            });
            listElement.appendChild(label);
        });
        updateVariableButtonText();
    }

    function updateVariableButtonText() {
        const buttonText = variableButton.querySelector('span');
        if (!buttonText) return;
        if (selectedVariables.length === 0) buttonText.textContent = "Seleccionar variables...";
        else if (selectedVariables.length === 1) buttonText.textContent = selectedVariables[0];
        else buttonText.textContent = `${selectedVariables.length} variables seleccionadas`;
    }

    function applyFilters() {
        const searchTerm = searchInput.value.toLowerCase();
        const estado = estadoFilter.value;
        const matriz = matrizFilter.value;
        const componente = componenteFilter.value;
        const actividad = actividadFilter.value;
        const metodo = metodoFilter.value;
        const hasActiveFilters = searchTerm || estado || matriz || componente || actividad || metodo || selectedVariables.length > 0;
        if (!hasActiveFilters) {
            resultsContainer.innerHTML = "";
            resultsSummary.style.display = "none";
            noResultsDiv.style.display = "none";
            statusContainer.style.display = "block";
            return;
        }
        statusContainer.style.display = "none";
        const filtered = fullData.filter(item => {
            const variableMatch = selectedVariables.length === 0 || selectedVariables.includes(item.variable);
            return (searchTerm === "" || (item.nombreLab && item.nombreLab.toLowerCase().includes(searchTerm))) &&
                   (estado === "" || item.estado === estado) &&
                   (matriz === "" || item.matriz === matriz) &&
                   (componente === "" || item.componente === componente) &&
                   (actividad === "" || item.actividad === actividad) &&
                   variableMatch &&
                   (metodo === "" || item.metodo === metodo);
        });
        displayResults(filtered);
    }

    function displayResults(data: RowData[]) {
        resultsContainer.innerHTML = "";
        if (data.length === 0) {
            noResultsDiv.style.display = "block";
            resultsSummary.style.display = "none";
            return;
        }
        noResultsDiv.style.display = "none";
        resultsSummary.style.display = "block";
        const labs = data.reduce((acc, item) => {
            if (!acc[item.nombreLab]) acc[item.nombreLab] = [];
            acc[item.nombreLab].push(item);
            return acc;
        }, {} as { [key: string]: RowData[] });

        const sortedNames = Object.keys(labs).sort();
        resultsSummary.textContent = `Mostrando ${sortedNames.length} laboratorios que coinciden.`;

        for (const labName of sortedNames) {
            const items = labs[labName];
            const card = document.createElement('div');
            card.className = "bg-white p-5 rounded-lg shadow-sm border border-gray-200";
            card.innerHTML = `
                <div class="flex justify-between items-start mb-4">
                    <h3 class="text-lg font-bold text-indigo-700">${labName}</h3>
                    <span class="text-xs font-semibold px-2 py-1 uppercase rounded-full bg-indigo-100 text-indigo-800">${items[0].estado}</span>
                </div>
                <div class="overflow-x-auto">
                    <table class="min-w-full text-xs">
                        <thead class="bg-gray-50"><tr><th class="px-2 py-1">Matriz</th><th class="px-2 py-1">Variable</th><th class="px-2 py-1">Método</th></tr></thead>
                        <tbody>${items.map(i => `<tr><td class="px-2 py-1">${i.matriz}</td><td class="px-2 py-1">${i.variable}</td><td class="px-2 py-1">${i.metodo}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            `;
            resultsContainer.appendChild(card);
        }
    }

    function clearAllFilters() {
        searchInput.value = "";
        estadoFilter.value = "";
        matrizFilter.value = "";
        componenteFilter.value = "";
        actividadFilter.value = "";
        metodoFilter.value = "";
        selectedVariables = [];
        updateDependentFilters();
    }

    // --- EVENT LISTENERS ---
    searchInput.addEventListener('input', applyFilters);
    estadoFilter.addEventListener('change', () => updateDependentFilters('estado'));
    matrizFilter.addEventListener('change', () => updateDependentFilters('matriz'));
    componenteFilter.addEventListener('change', () => updateDependentFilters('componente'));
    actividadFilter.addEventListener('change', () => updateDependentFilters('actividad'));
    metodoFilter.addEventListener('change', applyFilters);
    variableButton.addEventListener('click', () => variablePanel.classList.toggle('hidden'));
    variableSearch.addEventListener('input', () => updateDynamicMultiSelect(variableList, 'variable', [matrizFilter, componenteFilter, actividadFilter]));
    clearButton.addEventListener('click', clearAllFilters);
    brandFilter.addEventListener('change', () => { updateModelFilter(); generateDashboardData(); });
    modelFilter.addEventListener('change', generateDashboardData);
    submitAiPromptBtn.addEventListener('click', handleAiAnalysis);

    // --- INITIALIZATION ---
    loadDataFromSource();
});
