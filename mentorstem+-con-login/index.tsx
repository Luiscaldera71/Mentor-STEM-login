

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Chat } from "@google/genai";

declare const html2pdf: any;
declare const firebase: any;

// --- FIREBASE CONFIG ---
// IMPORTANTE: Reemplaza esto con tu propia configuración de Firebase.
// La puedes encontrar en tu consola de Firebase > Configuración del proyecto.
const firebaseConfig = {
  apiKey: AIzaSyDwM1HN5MSMkME5FjG_hJ_rKvKEGXNMobw,
  authDomain: https://stem-insights.web.app/,
  databaseURL: "TU_DATABASE_URL",
  projectId: "TU_PROJECT_ID",
  storageBucket: "TU_STORAGE_BUCKET",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId: "TU_APP_ID"
};

// --- TYPE DEFINITIONS ---
interface User {
  username: string;
  // La contraseña se usa solo para la lógica de la app, no se debe almacenar así en producción.
  // Firebase Auth sería la solución real. Aquí simulamos con Realtime DB.
  password?: string; 
}

interface ProjectFeedback {
  rating: number;
  wentWell: string;
  couldImprove: string;
}

interface SavedProject {
  id: number;
  grade: string;
  topic: string;
  resources: string;
  time: string;
  proposalName: string;
  planMarkdown: string;
  feedback?: ProjectFeedback;
}

type AppView = 'login' | 'form' | 'proposals' | 'plan' | 'history' | 'loading' | 'help' | 'feedback';

// --- MODEL & API CONFIG ---
const MODEL_NAME = 'gemini-2.5-flash';
let ai: GoogleGenAI;
let chat: Chat;

// --- STATE ---
let currentUser: User | null = null;
let currentProjectData: Omit<SavedProject, 'id' | 'planMarkdown' | 'proposalName'> | null = null;
const synth = window.speechSynthesis;
let podcastScriptSentences: string[] = [];
let currentSentenceIndex = 0;
let preferredVoice: SpeechSynthesisVoice | null = null;

// --- DATABASE ---
let db: any;


// --- DOM Elements ---
let loginContainer: HTMLElement;
let appContainer: HTMLElement;
let loginForm: HTMLFormElement;
let registerForm: HTMLFormElement;
let loginTabBtn: HTMLButtonElement;
let registerTabBtn: HTMLButtonElement;
let authErrorMsg: HTMLElement;

let projectFormContainer: HTMLElement;
let formElement: HTMLFormElement;
let gradeInput: HTMLSelectElement;
let topicInput: HTMLInputElement;
let resourcesSelect: HTMLSelectElement;
let timeInput: HTMLInputElement;
let submitButton: HTMLButtonElement;
let loadingIndicator: HTMLElement;

let proposalsSection: HTMLElement;
let proposalsHeading: HTMLElement;
let proposalCardsArea: HTMLElement;

let detailedPlanSection: HTMLElement;

let navHomeButton: HTMLButtonElement;
let navHistoryButton: HTMLButtonElement;
let navHelpButton: HTMLButtonElement;
let navLogoutButton: HTMLButtonElement;
let historyBadge: HTMLElement;
let historySection: HTMLElement;
let helpSection: HTMLElement;
let feedbackSection: HTMLElement;
let historyListArea: HTMLElement;
let backToFormFromHistoryButton: HTMLButtonElement;

let logoRightInput: HTMLInputElement;

let podcastPlayerContainer: HTMLElement;
let podcastTextDisplay: HTMLElement;
let podcastPlayPauseBtn: HTMLButtonElement;
let podcastStopBtn: HTMLButtonElement;
let podcastProgressBarFill: HTMLElement;
let podcastDownloadBtn: HTMLButtonElement;


const SYSTEM_INSTRUCTION = `
# ROLE & GOAL
You are "MentorSTEM+", an expert instructional designer and pedagogical assistant. Your primary goal is to empower teachers in rural schools in Córdoba, Colombia, by rapidly generating high-quality, practical, and creative STEM+ project plans based on the "STEM+ Córdoba 2024" methodology. You must be efficient, inferring details proactively to minimize teacher effort.

# CORE PROCESS
Your interaction with the user follows a strict, two-stage process. Adhere to it precisely.

---

## STAGE 1: PROPOSAL GENERATION

### --> INPUT
You will receive four key pieces of information:
1.  **Grade Level:** The target school grade (e.g., "5to Grado").
2.  **Topic:** A central theme or idea (e.g., "La contaminación del agua").
3.  **Resources:** A specific resource level, from A (most basic) to F (most advanced).
4.  **Timeframe:** The estimated duration of the project (e.g., "4 semanas").

### --> TASK
Based on the input, you will generate EXACTLY THREE (3) distinct project proposals. Each proposal must be a unique take on the topic, adapted specifically to the indicated resource level.

### --> OUTPUT FORMAT (CRITICAL)
Your response for this stage **MUST** only contain the proposals formatted exactly as follows. Use "---" as a separator between each proposal.

\`\`\`
PROPUESTA [Número]:
Nombre: [A short, engaging, and descriptive name for the proposal]
Resumen Clave: [A concise summary. It must state the main focus, the integrated STEM+ areas, and the final student product.]
Nivel de Recursos: Adecuado para [The exact resource option selected by the user, e.g., "Opción A (Aula Tradicional)"]
---
\`\`\`

**MANDATORY RULES for Stage 1 Output:**
*   DO NOT include any introductory text, greetings, or explanations before "PROPUESTA 1:".
*   DO NOT include any concluding text or questions after the final "---".
*   The separator MUST be exactly "---" on its own line.
*   Your entire response must be only the formatted proposal blocks. This is essential for automated parsing.

---

## STAGE 2: DETAILED PLAN GENERATION

### --> INPUT
The user will select one of the proposals by sending its name, like: \`Elijo la propuesta: "[Name of Chosen Proposal]"\`.

### --> TASK
You will immediately generate a complete, detailed, and practical project plan for the chosen proposal. The plan must follow the "FORMATO DE DISEÑO E IMPLEMENTACIÓN DE PROYECTOS STEM+" provided below.

### --> OUTPUT FORMAT
Your response for this stage **MUST** be ONLY the detailed plan in Markdown format.
*   DO NOT include any introductory text like "Aquí está el plan...".
*   DO NOT include any concluding summaries or remarks.
*   The response must start directly with "1. IDENTIFICACIÓN DEL PROYECTO STEM+".

---

## FORMATO DE DISEÑO E IMPLEMENTACIÓN DE PROYECTOS STEM+

**General Directive for the Plan:** Fill every section with concrete, actionable information. Imagine a teacher in a rural setting needs to be able to execute this plan with confidence.

**1. IDENTIFICACIÓN DEL PROYECTO STEM+**
   - **Nombre de Actividad/Proyecto:** [Name of the chosen proposal]
   - **Duración Estimada:** [Use the user's input]
   - **Docente(s) Responsable(s):** [Always output: "A completar por el docente"]
   - **Nivel del Proyecto:** [Infer: Micro (short, simple), Meso (class-wide, several weeks), or Macro (school-wide, long-term)]
   - **Grado:** [Use the user's input]
   - **Asignatura:** [Infer the primary subject, but emphasize interdisciplinarity]
   - **Institución Educativa:** [Always output: "A completar por el docente"]
   - **Área(s) de Conocimiento Integradas:** [Be specific. E.g., Ciencia (Biología), Tecnología (Uso de sensores caseros), Matemáticas (Estadística), Arte (Creación de infografías)]
   - **Resumen del Proyecto:** [Expand on the proposal's summary. Describe the project's purpose, key activities, and its relevance to the students' context.]

**2. PROYECCIÓN DEL PROYECTO**
   - **Objetivo de Aprendizaje:** [Define 2-3 clear, specific learning objectives. What will students *know* or *be able to do*? Use action verbs.]
   - **Aplicabilidad y Contexto:** [Crucial for relevance. Explain how the project connects to the students' real life, local community issues, or the rural environment of Córdoba. Be specific.]
   - **Recursos Disponibles:** [List the specific materials, tools, and technologies needed, ensuring they align perfectly with the user-selected resource level (A-F).]

**3. ESTRATEGIA METODOLÓGICA**
   - **Metodología Principal:** [Choose an active learning methodology (e.g., Project-Based Learning, Challenge-Based Learning, Design Thinking, Gamification). **Crucially, explain WHY this methodology is the best fit for this specific project and HOW the teacher would implement its key principles.**]
   - **Estrategias Didácticas:** [Describe specific teaching techniques. E.g., "Lluvia de ideas guiada", "Trabajo cooperativo en roles", "Demostraciones prácticas".]
   - **Participación Estudiantil:** [Explain how students will be active agents. E.g., "Los estudiantes tomarán decisiones sobre el diseño del prototipo", "Realizarán encuestas en su comunidad".]

**4. RESULTADOS ESPERADOS**
   - **Competencias Desarrolladas:** [List key 21st-century skills. E.g., Pensamiento Crítico, Colaboración, Comunicación, Creatividad. Link each one to a project activity.]
   - **Impacto en la Comunidad:** [Describe a tangible, potential benefit. E.g., "Una campaña de concienciación sobre el cuidado del agua", "Un prototipo de filtro de agua para la huerta escolar".]
   - **Sostenibilidad del Proyecto:** [Suggest how the project's outcomes or learnings could be maintained or replicated.]

**5. EVALUACIÓN Y REFLEXIÓN**
   - **Criterios de Evaluación:** [Define clear criteria. E.g., "Calidad de la investigación", "Funcionalidad del prototipo", "Claridad de la presentación final".]
   - **Instrumentos de Evaluación:** [Suggest specific tools. E.g., "Rúbrica para el prototipo (adjuntar ejemplo simple)", "Lista de cotejo para la presentación", "Autoevaluación del trabajo en equipo".]
   - **Estrategia de Reflexión:** [Propose concrete reflection activities. E.g., "Crear un diario de proyecto", "Ronda de 'qué funcionó, qué no' al final de cada fase".]

**6. DESARROLLO DEL PROYECTO (Metodología STEM+ Córdoba)**
   **Guideline:** The sum of phase times must align with the total project duration. Descriptions must be extremely thorough, providing a complete guide for the teacher.

   **Explora (Identificar problema)**
   - **Descripción breve de fase:** Los estudiantes analizan su entorno para identificar un problema real y relevante, desarrollando pensamiento crítico y curiosidad.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** No te limites a enumerar pasos. Describe la fase de forma narrativa y completa, explicando el 'cómo' y el 'porqué'.
     - **Rol del Docente:** Detalla cómo el docente debe facilitar la actividad. Ejemplo: "El docente introduce la fase con una historia o pregunta provocadora sobre el tema. Durante la exploración, actúa como un guía, formulando preguntas abiertas ('¿Qué pasaría si...?', '¿Por qué creen que esto ocurre aquí?') para profundizar el análisis de los estudiantes sin dar respuestas directas."
     - **Actividades del Estudiante (Paso a Paso):** Describe vívidamente la experiencia del estudiante. Ejemplo: "Organizados en equipos, los estudiantes se convierten en 'detectives del entorno'. Realizan una expedición (sea en el patio, la huerta o a través de imágenes y videos si es en el aula) para buscar evidencias del problema. Usan sus bitácoras para dibujar, tomar notas, y registrar datos (e.g., número de envoltorios de plástico en 10 metros cuadrados). El objetivo es que se sumerjan en el contexto del problema."
     - **Entregable de la Fase:** Especifica el resultado tangible. Ejemplo: "Al final, cada equipo debe crear un 'Muro de Evidencias' (una cartulina o sección del pizarrón) con sus hallazgos, incluyendo fotos, dibujos, datos y una declaración clara del problema principal que han decidido abordar."
    ]
   - **Recursos Utilizados:** [List specific resources for THIS phase, linking them to the activities described.]
   - **Tiempo Estimado:** [Allocate a proportional time for this phase.]

   **Imagina (Plantear soluciones)**
   - **Descripción breve de fase:** En equipo, generan ideas innovadoras basadas en conocimientos STEM, fomentando creatividad, resolución de problemas y trabajo colaborativo.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** Describe un proceso de ideación estructurado y creativo.
     - **Rol del Docente:** Explica cómo el docente modera la sesión de ideación. Ejemplo: "El docente enseña y modela una técnica de lluvia de ideas como 'SCAMPER' o 'Crazy 8s'. Su rol es asegurar un ambiente donde todas las ideas son válidas, fomentar la construcción sobre las ideas de otros y gestionar el tiempo para mantener la energía creativa."
     - **Actividades del Estudiante (Paso a Paso):** Detalla el proceso. Ejemplo: "Cada estudiante, individualmente, genera 8 ideas rápidas en 8 minutos ('Crazy 8s'). Luego, en sus equipos, comparten sus mejores ideas. El equipo las discute, las combina y las mejora, seleccionando las dos más prometedoras. Para cada una, deben crear un boceto más detallado, explicando cómo funcionaría y qué la hace innovadora."
     - **Entregable de la Fase:** Especifica el resultado. Ejemplo: "Cada equipo entrega dos 'fichas de solución', que incluyen el boceto de la idea, una breve descripción de su funcionamiento, los materiales necesarios y por qué creen que podría resolver el problema."
    ]
   - **Recursos Utilizados:** [List resources for THIS phase.]
   - **Tiempo Estimado:** [Allocate proportional time.]

   **Crea (Construir prototipos)**
   - **Descripción breve de fase:** Diseñan y construyen prototipos con herramientas digitales y materiales accesibles, aplicando experimentación y toma de decisiones.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** Enfócate en el proceso de construcción y la toma de decisiones.
     - **Rol del Docente:** Describe el rol de soporte del docente. Ejemplo: "El docente se asegura de que los materiales estén organizados y accesibles. No construye nada por los estudiantes, pero ofrece 'micro-lecciones' técnicas si son necesarias (e.g., cómo hacer una conexión en serie, cómo usar una pistola de silicona de forma segura). Monitorea el progreso y ayuda a los equipos a superar bloqueos."
     - **Actividades del Estudiante (Paso a Paso):** Describe la construcción. Ejemplo: "Basándose en su ficha de solución, el equipo elabora un plan de construcción dividiendo tareas. Luego, se sumergen en la fase de 'manos a la obra', ensamblando su prototipo. Deben documentar el proceso con fotos o videos cortos, explicando las decisiones que toman y los problemas que encuentran en el camino ('Nuestro plan original no funcionó porque..., así que decidimos...')."
     - **Entregable de la Fase:** Especifica el prototipo. Ejemplo: "Un prototipo funcional (o una representación a escala) de su solución, acompañado de un 'diario de construcción' que documenta el proceso."
    ]
   - **Recursos Utilizados:** [List resources for THIS phase.]
   - **Tiempo Estimado:** [Allocate proportional time.]

   **Refina (Probar y mejorar)**
   - **Descripción breve de fase:** Prueban y optimizan sus soluciones mediante análisis iterativo, fortaleciendo el pensamiento crítico y la mejora continua.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** Detalla el ciclo de prueba, retroalimentación y mejora.
     - **Rol del Docente:** Explica cómo el docente organiza las pruebas. Ejemplo: "El docente establece 'estaciones de prueba' con criterios claros y medibles (e.g., '¿El puente soporta 1kg?', '¿El filtro clarifica el agua en menos de 5 minutos?'). Facilita sesiones de retroalimentación constructiva entre equipos, enseñando a dar y recibir críticas de manera respetuosa."
     - **Actividades del Estudiante (Paso a Paso):** Describe el proceso de prueba. Ejemplo: "El equipo somete su prototipo a las pruebas definidas, registrando meticulosamente los resultados (éxitos y fracasos). Presentan su prototipo a otro equipo para recibir retroalimentación. Con base en los datos de las pruebas y la retroalimentación recibida, discuten y deciden qué mejoras específicas implementarán. Luego, realizan una segunda ronda de construcción y pruebas."
     - **Entregable de la Fase:** Especifica el resultado final. Ejemplo: "El prototipo mejorado y una 'tabla de mejoras' que muestre los resultados de la Prueba 1, la retroalimentación recibida, los cambios realizados y los resultados de la Prueba 2."
    ]
   - **Recursos Utilizados:** [List resources for THIS phase.]
   - **Tiempo Estimado:** [Allocate proportional time.]

   **Reflexiona (Revisión del Proyecto y Proceso)**
   - **Descripción breve de fase:** Los estudiantes analizan su proceso de trabajo, reflexionan sobre lo aprendido y documentan las estrategias que resultaron más efectivas.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** Proporciona métodos concretos para la reflexión individual y grupal.
     - **Rol del Docente:** Explica cómo guiar la metacognición. Ejemplo: "El docente lidera una discusión grupal usando la rutina de pensamiento 'Solía pensar... Ahora pienso...'. Proporciona una plantilla simple en el diario de proyecto para la reflexión individual, asegurando que los estudiantes piensen no solo en el contenido, sino en sus habilidades (e.g., colaboración, resolución de problemas)."
     - **Actividades del Estudiante (Paso a Paso):** Detalla la actividad de reflexión. Ejemplo: "Individualmente, los estudiantes completan una entrada en su diario respondiendo a: 1. ¿Cuál fue mi mayor contribución al equipo? 2. ¿Qué habilidad nueva desarrollé durante este proyecto? 3. Si volviera a hacer este proyecto, ¿qué haría de manera diferente? Luego, en equipo, crean un 'mapa de proceso' que visualiza su viaje, destacando los momentos clave, los desafíos y los aprendizajes."
     - **Entregable de la Fase:** Especifica el producto de la reflexión. Ejemplo: "La entrada completada del diario de proyecto y el 'mapa de proceso' del equipo."
    ]
   - **Recursos Utilizados:** [List resources for THIS phase.]
   - **Tiempo Estimado:** [Allocate proportional time.]

   **Comparte (Evaluar proyecto)**
   - **Descripción breve de fase:** Presentan y evalúan su proyecto, desarrollando habilidades de comunicación, liderazgo y síntesis de información.
   - **Guía Detallada de Actividades:** [**INSTRUCCIÓN CRÍTICA:** Describe un evento de presentación significativo, no solo una exposición.
     - **Rol del Docente:** Explica cómo organizar el evento final. Ejemplo: "El docente organiza una 'Feria de Soluciones' e invita a otros cursos, padres o miembros de la comunidad. Define claramente el formato de la presentación (e.g., 3 minutos de exposición, 2 de preguntas) y proporciona una rúbrica de evaluación para que el público también pueda dar retroalimentación."
     - **Actividades del Estudiante (Paso a Paso):** Detalla la preparación y la presentación. Ejemplo: "El equipo prepara su presentación. Asignan roles (un presentador, un demostrador del prototipo, un encargado de responder preguntas). Practican para ser claros y concisos. Durante la feria, presentan su proyecto a diferentes audiencias, adaptando su lenguaje. Recopilan la retroalimentación recibida de los visitantes."
     - **Entregable de la Fase:** Especifica la presentación final. Ejemplo: "Una presentación oral y visual del proyecto completo (problema, proceso, solución y resultados) en la 'Feria de Soluciones'."
    ]
   - **Recursos Utilizados:** [List resources for THIS phase.]
   - **Tiempo Estimado:** [Allocate proportional time.]

**7. OBSERVACIONES Y RECOMENDACIONES**
   - **Observaciones:** [Provide one or two useful tips for the teacher, e.g., "Se recomienda documentar el proceso con fotografías para crear un mural final", "Este proyecto puede adaptarse para..."]
`;

// --- INITIALIZATION ---
async function init() {
  // Query all DOM Elements first
  loginContainer = document.getElementById('login-container')!;
  appContainer = document.getElementById('app-container')!;
  loginForm = document.getElementById('login-form') as HTMLFormElement;
  registerForm = document.getElementById('register-form') as HTMLFormElement;
  loginTabBtn = document.getElementById('login-tab-button') as HTMLButtonElement;
  registerTabBtn = document.getElementById('register-tab-button') as HTMLButtonElement;
  authErrorMsg = document.getElementById('auth-error') as HTMLElement;
  
  projectFormContainer = document.getElementById('project-form-container')!;
  formElement = document.getElementById('project-form') as HTMLFormElement;
  gradeInput = document.getElementById('grade') as HTMLSelectElement;
  topicInput = document.getElementById('topic') as HTMLInputElement;
  resourcesSelect = document.getElementById('resources') as HTMLSelectElement;
  timeInput = document.getElementById('time') as HTMLInputElement;
  submitButton = document.getElementById('submit-form-button') as HTMLButtonElement;
  loadingIndicator = document.getElementById('loading-indicator')!;

  proposalsSection = document.getElementById('proposals-section')!;
  proposalsHeading = document.getElementById('proposals-heading')!; 
  proposalCardsArea = document.getElementById('proposal-cards-area')!;
  detailedPlanSection = document.getElementById('detailed-plan-section')!;

  navHomeButton = document.getElementById('nav-home') as HTMLButtonElement;
  navHistoryButton = document.getElementById('nav-history') as HTMLButtonElement;
  navHelpButton = document.getElementById('nav-help') as HTMLButtonElement;
  navLogoutButton = document.getElementById('nav-logout') as HTMLButtonElement;
  historyBadge = document.getElementById('history-badge') as HTMLElement;
  historySection = document.getElementById('history-section')!;
  helpSection = document.getElementById('help-section')!;
  feedbackSection = document.getElementById('feedback-section')!;
  historyListArea = document.getElementById('history-list-area')!;
  backToFormFromHistoryButton = document.getElementById('back-to-form-from-history-button') as HTMLButtonElement;
  
  logoRightInput = document.getElementById('logo-right-input') as HTMLInputElement;

  podcastPlayerContainer = document.getElementById('podcast-player-container')!;
  podcastTextDisplay = document.getElementById('podcast-text-display')!;
  podcastPlayPauseBtn = document.getElementById('podcast-play-pause-btn') as HTMLButtonElement;
  podcastStopBtn = document.getElementById('podcast-stop-btn') as HTMLButtonElement;
  podcastProgressBarFill = document.getElementById('podcast-progress-bar-fill')!;
  podcastDownloadBtn = document.getElementById('podcast-download-btn') as HTMLButtonElement;

  try {
    // Initialize Firebase
    if (firebaseConfig.apiKey === "TU_API_KEY") {
        const errorContainer = document.getElementById('login-container') || document.body;
        errorContainer.innerHTML = `<div class="login-box" style="text-align: left;"><h3 style="color: red;">Error de Configuración</h3><p>Firebase no está configurado. Por favor, añade tus credenciales en el archivo <strong>index.tsx</strong> en la variable <code>firebaseConfig</code> para continuar.</p></div>`;
        return;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
  
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    chat = ai.chats.create({
      model: MODEL_NAME,
      config: { systemInstruction: SYSTEM_INSTRUCTION },
    });
  } catch(e) {
    console.error("Error initializing services:", e);
    const errorContainer = document.getElementById('app-container') || document.body;
    errorContainer.innerHTML = `<p style="color:red; padding:1em;">Error al inicializar los servicios (Gemini o Firebase). Asegúrate de que las API Keys y la configuración de Firebase sean correctas. Consulta la consola para más detalles.</p>`;
    return;
  }
  
  // Event Listeners
  loginForm.addEventListener('submit', handleLogin);
  registerForm.addEventListener('submit', handleRegister);
  loginTabBtn.addEventListener('click', () => switchAuthTab('login'));
  registerTabBtn.addEventListener('click', () => switchAuthTab('register'));

  formElement.addEventListener('submit', handleFormSubmit);
  navHomeButton.addEventListener('click', () => showView('form'));
  navHistoryButton.addEventListener('click', async () => {
    await renderHistoryList(); // History list is now async
    showView('history');
  });
  navHelpButton.addEventListener('click', () => showView('help'));
  navLogoutButton.addEventListener('click', handleLogout);
  backToFormFromHistoryButton.addEventListener('click', () => showView('form'));
  podcastPlayPauseBtn.addEventListener('click', handlePlayPause);
  podcastStopBtn.addEventListener('click', resetPodcast);


  const handleLogoChange = (event: Event, placeholderId: string) => {
    const input = event.target as HTMLInputElement;
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    const file = input.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const imageUrl = e.target?.result as string;
        placeholder.style.backgroundImage = `url(${imageUrl})`;
        placeholder.style.backgroundSize = 'contain';
        placeholder.style.backgroundPosition = 'center';
        placeholder.style.backgroundRepeat = 'no-repeat';
        const span = placeholder.querySelector('span');
        if (span) span.style.display = 'none';
        placeholder.style.border = '1px solid #ccd0d5';
      };
      reader.readAsDataURL(file);
    }
  };
  
  logoRightInput.addEventListener('change', (e) => handleLogoChange(e, 'logo-right'));

  checkLoginState();
}

// --- VIEW MANAGEMENT ---
async function showView(view: AppView) {
    if (view === 'login') {
        appContainer.style.display = 'none';
        loginContainer.style.display = 'flex';
        return;
    }
    
    // If not login view, ensure app is visible
    appContainer.style.display = 'flex';
    loginContainer.style.display = 'none';

    if (view !== 'plan') {
      dismissPodcast();
    }
    projectFormContainer.style.display = 'none';
    proposalsSection.style.display = 'none';
    detailedPlanSection.style.display = 'none';
    historySection.style.display = 'none';
    helpSection.style.display = 'none';
    feedbackSection.style.display = 'none';
    loadingIndicator.style.display = 'none';
    submitButton.disabled = false;
    submitButton.textContent = 'Generar Propuestas de Proyecto';

    const navButtons = [navHomeButton, navHistoryButton, navHelpButton];

    if(view !== 'plan' && view !== 'feedback') { // Don't change nav state for sub-views
        navButtons.forEach(btn => btn?.classList.remove('active'));
    }

    switch (view) {
        case 'form':
            projectFormContainer.style.display = 'block';
            navHomeButton?.classList.add('active');
            break;
        case 'proposals':
            proposalsSection.style.display = 'block';
            navHomeButton?.classList.add('active'); // Part of home flow
            break;
        case 'plan':
            detailedPlanSection.style.display = 'block';
            break;
        case 'history':
            historySection.style.display = 'block';
            navHistoryButton?.classList.add('active');
            break;
        case 'help':
            helpSection.style.display = 'block';
            navHelpButton?.classList.add('active');
            break;
        case 'feedback':
            feedbackSection.style.display = 'block';
            navHistoryButton?.classList.add('active'); // Part of history flow
            break;
        case 'loading':
            loadingIndicator.style.display = 'flex';
            submitButton.disabled = true;
            submitButton.textContent = 'Generando...';
            break;
    }
}


// --- CORE LOGIC ---
async function handleFormSubmit(event: Event) {
  event.preventDefault();

  const currentGrade = gradeInput.value;
  const currentTopic = topicInput.value;
  const currentResources = resourcesSelect.value;
  const currentTime = timeInput.value;

  if (!currentGrade || !currentTopic || !currentResources || !currentTime) {
    alert("Por favor, completa todos los campos del formulario.");
    return;
  }
  
  currentProjectData = {
    grade: currentGrade,
    topic: currentTopic,
    resources: currentResources,
    time: currentTime,
  };

  const resourceOptionFullText = resourcesSelect.options[resourcesSelect.selectedIndex]?.text || 'No especificado';

  showView('loading');
  proposalCardsArea.innerHTML = ''; // Clear previous

  const initialDataForAI = `
    Grado(s): ${currentGrade}
    Tema: ${currentTopic}
    Recursos: Opción ${currentResources} (${resourceOptionFullText.split(':')[0].trim()})
    Tiempo estimado: ${currentTime}
  `;
  
  try {
    const stream = await chat.sendMessageStream({ message: `Datos para generación de propuestas:\n${initialDataForAI}` });
    
    let fullResponse = "";
    for await (const chunk of stream) {
        const text = chunk.text;
        fullResponse += text;
    }
    parseAndDisplayProposals(fullResponse);
    showView('proposals');

  } catch (error) {
    console.error("Error sending message to Gemini:", error);
    displayError("Hubo un error al contactar al asistente. Por favor, inténtalo de nuevo.");
    showView('form');
  }
}

function parseAndDisplayProposals(responseText: string) {
    const proposalsText = responseText.trim();
    
    const proposals: { name: string, summary: string, resources: string }[] = [];
    const proposalBlockRegex = /PROPUESTA\s*\d*:\s*([\s\S]*?)(?=---|$)/gi;
    let matchResult;

    while ((matchResult = proposalBlockRegex.exec(proposalsText)) !== null) {
        const blockContent = matchResult[1].trim(); 

        const nameMatch = blockContent.match(/^Nombre:\s*(.*)/im);
        const summaryMatch = blockContent.match(/^Resumen Clave:\s*(.*)/im);
        const resourcesMatch = blockContent.match(/^Nivel de Recursos:\s*(.*)/im);
        
        if (nameMatch && nameMatch[1]) {
            proposals.push({
                name: nameMatch[1].trim(),
                summary: summaryMatch ? summaryMatch[1].trim() : "No se encontró resumen.",
                resources: resourcesMatch ? resourcesMatch[1].trim() : "No se especificó nivel."
            });
        }
    }
    
    if (proposals.length > 0) {
        proposals.forEach((proposal) => {
            const card = document.createElement('div');
            card.className = 'proposal-card';
            
            card.innerHTML = `
                <div class="proposal-card-title">${escapeHtml(proposal.name)}</div>
                <p class="proposal-card-summary">${proposal.summary.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>
                <div class="proposal-card-resources"><strong>Recursos:</strong> ${escapeHtml(proposal.resources)}</div>
            `;

            const selectButton = document.createElement('button');
            selectButton.className = 'proposal-card-select-button';
            selectButton.textContent = 'Seleccionar esta Propuesta';
            selectButton.title = `Seleccionar propuesta: ${proposal.name}`;
            selectButton.addEventListener('click', () => {
                handleProposalSelection(proposal.name);
            });
            card.appendChild(selectButton);
            proposalCardsArea.appendChild(card);
        });

    } else { 
        const noProposalsMessage = document.createElement('p');
        if (proposalsText.length > 500) { 
             noProposalsMessage.textContent = "El asistente respondió, pero no se pudieron extraer propuestas en el formato esperado. Por favor, revisa la consola o intenta de nuevo.";
        } else if (proposalsText.trim() === "") {
             noProposalsMessage.textContent = "El asistente no generó propuestas. Por favor, intenta de nuevo.";
        } else {
             noProposalsMessage.textContent = `No se pudieron extraer propuestas. Respuesta recibida: "${proposalsText.substring(0,100)}..."`;
        }
        noProposalsMessage.className = 'error-message';
        proposalCardsArea.appendChild(noProposalsMessage);
    }
}


async function handleProposalSelection(proposalName: string) {
  showView('loading');
  detailedPlanSection.innerHTML = '';

  try {
    const stream = await chat.sendMessageStream({ message: `Elijo la propuesta: "${proposalName}".\n\nGenera el plan de proyecto detallado para esta propuesta.` });
    
    let fullPlanMarkdown = "";
    for await (const chunk of stream) {
        const text = chunk.text;
        fullPlanMarkdown += text;
    }
    
    renderDetailedPlan(fullPlanMarkdown.trim(), proposalName);

  } catch (error) {
    console.error("Error sending message to Gemini for plan:", error);
    displayError("Hubo un error al generar el plan detallado. Por favor, inténtalo de nuevo.", detailedPlanSection);
    showView('proposals');
  }
}

function renderDetailedPlan(markdownText: string, proposalName: string, options: { isEditable?: boolean, fromHistory?: boolean, projectToEdit?: SavedProject } = {}) {
    detailedPlanSection.innerHTML = ''; 

    // Manage active nav state
    const navButtons = [navHomeButton, navHistoryButton, navHelpButton];
    navButtons.forEach(btn => btn?.classList.remove('active'));

    if (options.fromHistory || options.isEditable) {
        navHistoryButton?.classList.add('active');
    } else {
        navHomeButton?.classList.add('active');
    }

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'plan-controls';

    const backButton = document.createElement('button');
    backButton.id = 'back-to-form-button';
    backButton.textContent = '← Volver a Empezar';
    backButton.title = 'Regresa al formulario para generar nuevas propuestas';
    backButton.onclick = () => {
        showView('form');
        formElement.reset();
        resetLogoPlaceholders();
    };

    const printButton = document.createElement('button');
    printButton.id = 'print-plan-button';
    printButton.textContent = '🖨️ Imprimir / Guardar PDF';
    printButton.title = 'Generar un PDF del plan y descargarlo';
    printButton.disabled = !!options.isEditable; // Disable printing in edit mode
    if(options.isEditable) {
        printButton.title = 'Guarde los cambios primero para poder imprimir';
    }

    const podcastButton = document.createElement('button');
    podcastButton.id = 'generate-podcast-button';
    podcastButton.textContent = '🎙️ Crear Podcast';
    podcastButton.title = 'Generar un resumen en audio del plan';
    podcastButton.disabled = !!options.isEditable;
    podcastButton.onclick = () => handleGeneratePodcast(markdownText, podcastButton);
    
    controlsContainer.append(backButton, printButton, podcastButton);

    if (options.isEditable && options.projectToEdit) {
        const saveChangesButton = document.createElement('button');
        saveChangesButton.id = 'save-plan-button'; // Reuse ID for styling
        saveChangesButton.textContent = '💾 Guardar Cambios';
        saveChangesButton.title = 'Guardar los cambios en el historial';
        saveChangesButton.onclick = async () => {
            const accordionItems = document.querySelectorAll('#plan-accordion-container .accordion-item');
            const newMarkdownParts: string[] = [];
            accordionItems.forEach(item => {
                const button = item.querySelector('.accordion-button > span:first-child') as HTMLElement;
                const textarea = item.querySelector('.editable-plan-section') as HTMLTextAreaElement;
                if (button && textarea) {
                    newMarkdownParts.push(button.innerText.trim() + '\n' + textarea.value);
                }
            });
            const newMarkdown = newMarkdownParts.join('\n');
            await updateProjectInHistory(options.projectToEdit!.id, { planMarkdown: newMarkdown });
            // After saving, re-render in non-edit mode
            renderDetailedPlan(newMarkdown, options.projectToEdit!.proposalName, { fromHistory: true });
        };
        controlsContainer.appendChild(saveChangesButton);
    } else if (currentProjectData) { // Only show for newly generated projects
        const saveButton = document.createElement('button');
        saveButton.id = 'save-plan-button';
        saveButton.textContent = '💾 Guardar en Historial';
        saveButton.title = 'Guardar este plan en tu historial local';
        saveButton.onclick = async () => {
            if (!currentProjectData) return;
            const newProject: SavedProject = {
                id: Date.now(),
                ...currentProjectData,
                proposalName: proposalName,
                planMarkdown: markdownText
            };
            await saveProjectToHistory(newProject);
            saveButton.textContent = '✅ Guardado';
            saveButton.disabled = true;
            updateHistoryBadge();
        };
        controlsContainer.appendChild(saveButton);
    }
    
    detailedPlanSection.appendChild(controlsContainer);

    const printableArea = document.createElement('div');
    printableArea.id = 'printable-area';
    
    const planHeader = document.createElement('div');
    planHeader.className = 'plan-header';
    planHeader.innerHTML = `
        <div class="logo-placeholder" id="logo-left" title="Escudo Universidad de Córdoba">
            <span></span>
        </div>
        <div class="header-text-content">
            <h1>MENTOR STEM+</h1>
            <p>UN PROYECTO DE LA UNIVERSIDAD DE CÓRDOBA EN EL MARCO DEL PROYECTO DE EXTENSIÓN: ESTRATEGIAS METODOLÓGICAS CON ENFOQUE STEM+ CON BASE EN LINEAMIENTOS CURRICULARES Y EXPERIENCIAS INVESTIGATIVAS PREVIAS PARA EL DESARROLLO DE COMPETENCIAS DEL SIGLO XXI EN INSTITUCIONES EDUCATIVAS RURALES DE CÓRDOBA</p>
        </div>
        <div class="logo-placeholder" id="logo-right" title="Espacio para el logo derecho">
            <span>LOGO DERECHO</span>
        </div>
    `;
    printableArea.appendChild(planHeader);
    
    const logoLeftPlaceholder = planHeader.querySelector<HTMLElement>('#logo-left')!;
    const logoRightPlaceholder = planHeader.querySelector<HTMLElement>('#logo-right')!;
    
    // Set static left logo
    const logoUrl = 'https://upload.wikimedia.org/wikipedia/commons/9/9e/Escudo_Universidad_de_C%C3%B3rdoba.png';
    logoLeftPlaceholder.style.backgroundImage = `url('${logoUrl}')`;
    logoLeftPlaceholder.style.backgroundSize = 'contain';
    logoLeftPlaceholder.style.backgroundPosition = 'center';
    logoLeftPlaceholder.style.backgroundRepeat = 'no-repeat';
    logoLeftPlaceholder.style.border = '1px solid #ccd0d5';
    logoLeftPlaceholder.style.cursor = 'default';
    const leftSpan = logoLeftPlaceholder.querySelector('span');
    if (leftSpan) leftSpan.style.display = 'none';

    logoRightPlaceholder.addEventListener('click', () => logoRightInput.click());

    const planTitleHeader = document.createElement('div');
    planTitleHeader.className = 'plan-title-header';
    planTitleHeader.innerHTML = `
        <hr>
        <h2>${escapeHtml(proposalName)}</h2>
    `;
    printableArea.appendChild(planTitleHeader);

    const accordionContainer = document.createElement('div');
    accordionContainer.id = 'plan-accordion-container';

    let cleanedMarkdown = markdownText.trim();
    const fenceRegex = /```(\w*)?\s*\n([\s\S]*?)```/;
    const match = cleanedMarkdown.match(fenceRegex);

    if (match && match[2] && match[2].trim().startsWith('1.')) {
        cleanedMarkdown = match[2].trim();
    }

    const sections = cleanedMarkdown.split(/\n(?=\d+\.\s+)/);

    sections.forEach((section, index) => {
        if (!section.trim()) return;

        const accordionItem = document.createElement('div');
        accordionItem.className = 'accordion-item';

        const button = document.createElement('button');
        button.className = 'accordion-button';

        const panel = document.createElement('div');
        panel.className = 'accordion-panel';

        const firstLineEnd = section.indexOf('\n');
        const title = (firstLineEnd !== -1) ? section.substring(0, firstLineEnd).trim() : section.trim();
        const content = (firstLineEnd !== -1) ? section.substring(firstLineEnd + 1) : '';

        button.innerHTML = `<span>${title}</span><span class="accordion-icon"></span>`;
        
        if (options.isEditable) {
            const textArea = document.createElement('textarea');
            textArea.className = 'editable-plan-section';
            textArea.value = content.trim();
            // Auto-resize logic
            const adjustHeight = () => {
                textArea.style.height = 'auto';
                textArea.style.height = (textArea.scrollHeight + 4) + 'px';
            };
            textArea.addEventListener('input', adjustHeight);
            panel.appendChild(textArea);
            setTimeout(adjustHeight, 1); // Adjust after render
        } else {
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'content-wrapper';
            contentWrapper.innerHTML = applyMarkdown(content);
            panel.appendChild(contentWrapper);
        }


        button.addEventListener('click', () => {
            button.classList.toggle('active');
            const panelElement = button.nextElementSibling as HTMLElement;
            if (panelElement.style.maxHeight) {
                panelElement.style.maxHeight = null!;
            } else {
                panelElement.style.maxHeight = panelElement.scrollHeight + "px";
            }
        });
        
        accordionItem.append(button, panel);
        accordionContainer.appendChild(accordionItem);

        if (index === 0) { // Auto-open first section
            button.classList.add('active');
            setTimeout(() => {
                if (button.nextElementSibling) {
                   const panelElement = button.nextElementSibling as HTMLElement;
                   panelElement.style.maxHeight = panelElement.scrollHeight + "px";
                }
            }, 50);
        }
    });
    
    printableArea.appendChild(accordionContainer);
    detailedPlanSection.appendChild(printableArea);

    setupPdfModal(proposalName, printButton);
    showView('plan');
}

// --- PODCAST & SPEECH SYNTHESIS ---

function getVoices(): Promise<SpeechSynthesisVoice[]> {
    return new Promise((resolve) => {
        let voices = synth.getVoices();
        if (voices.length) {
            resolve(voices);
            return;
        }
        synth.onvoiceschanged = () => {
            voices = synth.getVoices();
            resolve(voices);
        };
    });
}

async function selectBestSpanishVoice() {
    if (preferredVoice) return; 

    const voices = await getVoices();
    const spanishVoices = voices.filter(voice => voice.lang.startsWith('es-'));

    const qualityRank = (voice: SpeechSynthesisVoice) => {
        const name = voice.name.toLowerCase();
        const lang = voice.lang;
        if (lang === 'es-US' && name.includes('google')) return 5;
        if (name.includes('google')) return 4;
        if (voice.default) return 3;
        if (lang === 'es-ES') return 2;
        if (lang === 'es-CO') return 1;
        return 0;
    };

    spanishVoices.sort((a, b) => qualityRank(b) - qualityRank(a));
    
    if (spanishVoices.length > 0) {
        preferredVoice = spanishVoices[0];
    }
}

async function generatePodcastScript(markdownText: string): Promise<string> {
    const prompt = `Tu rol es ser un asistente de IA especializado en diseño instruccional, con una voz calmada, clara y perspicaz, similar a los resúmenes de audio de NotebookLM de Google. Tu objetivo es transformar el siguiente plan de proyecto en un guion de audio conciso (aproximadamente 2-3 minutos) para profesores. El guion debe ser conversacional y fácil de seguir en formato de solo audio.

Estructura el guion de la siguiente manera:
1.  **Introducción (1-2 frases):** Comienza con un saludo amigable y presenta el propósito del proyecto de una manera que despierte la curiosidad. Por ejemplo: "Hola. Analicemos juntos cómo este proyecto puede transformar tu aula."
2.  **Cuerpo principal:** Explica las fases más importantes del plan. No leas el plan textualmente. En su lugar, sintetiza cada fase, explicando su 'porqué' y 'cómo' de manera clara y directa. Usa frases de transición para conectar las ideas fluidamente, como "Una vez que los estudiantes han identificado el problema, la siguiente fase es imaginar soluciones...". Concéntrate en la metodología y los resultados esperados para los estudiantes.
3.  **Conclusión (1-2 frases):** Finaliza con una reflexión motivadora o un resumen del impacto del proyecto. Por ejemplo: "En resumen, este no es solo un proyecto sobre [tema], es una oportunidad para cultivar la creatividad y el pensamiento crítico. ¡Mucha suerte en su implementación!".

**Reglas Críticas:**
-   El resultado debe ser únicamente el texto del guion, sin ningún formato markdown, encabezados, o texto como "Introducción:".
-   Utiliza un español de Colombia natural y cercano.
-   El texto final debe estar listo para ser leído directamente por un motor de texto a voz.

Aquí está el plan del proyecto para transformar:
---
${markdownText}`;
    
    try {
        const response = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error generating podcast script:", error);
        return "Hubo un error al generar el guion para el podcast. Por favor, intenta de nuevo.";
    }
}

async function handleGeneratePodcast(markdownText: string, button: HTMLButtonElement) {
    if (!synth) {
        alert("Tu navegador no soporta la síntesis de voz.");
        return;
    }

    button.disabled = true;
    button.textContent = '🔊 Buscando voz...';
    await selectBestSpanishVoice();

    button.textContent = '📄 Generando Guion...';

    const rawScript = await generatePodcastScript(markdownText);
    
    // Clean the script to remove any markdown formatting (like asterisks) 
    // to prevent the TTS engine from reading them out loud (e.g., saying "asterisk crea asterisk").
    const script = rawScript.replace(/\*/g, '');
    
    button.disabled = false;
    button.textContent = '🎙️ Crear Podcast';

    if (script) {
        setupAndShowPodcastPlayer(script);
    }
}

function setupAndShowPodcastPlayer(script: string) {
    dismissPodcast(); // Clear any existing speech
    
    podcastScriptSentences = script.match(/[^.!?]+[.!?]+/g) || [script];
    currentSentenceIndex = 0;

    podcastProgressBarFill.style.width = '0%';
    podcastPlayerContainer.classList.add('visible');
    podcastTextDisplay.textContent = "Listo para reproducir. Presiona play.";
    podcastPlayPauseBtn.classList.remove('playing');
    podcastPlayPauseBtn.setAttribute('aria-label', 'Reproducir');

    podcastDownloadBtn.onclick = () => handleDownloadScript(script);
}

function handleDownloadScript(script: string) {
    if (!script) return;
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guion-podcast.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function handlePlayPause() {
    if (synth.paused) {
        synth.resume();
        podcastPlayPauseBtn.classList.add('playing');
        podcastPlayPauseBtn.setAttribute('aria-label', 'Pausar');
    } else if (synth.speaking) {
        synth.pause();
        podcastPlayPauseBtn.classList.remove('playing');
        podcastPlayPauseBtn.setAttribute('aria-label', 'Reproducir');
    } else {
        playPodcastSequence();
        podcastPlayPauseBtn.classList.add('playing');
        podcastPlayPauseBtn.setAttribute('aria-label', 'Pausar');
    }
}

function playPodcastSequence() {
    if (currentSentenceIndex >= podcastScriptSentences.length) {
        resetPodcast();
        return;
    }

    const sentence = podcastScriptSentences[currentSentenceIndex].trim();
    if (!sentence) { // Skip empty sentences
        currentSentenceIndex++;
        playPodcastSequence();
        return;
    }

    podcastTextDisplay.textContent = sentence;
    const utterance = new SpeechSynthesisUtterance(sentence);
    
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    } else {
        utterance.lang = 'es-CO'; // Fallback to desired language
    }
    
    utterance.rate = 1;
    utterance.pitch = 1;

    utterance.onend = () => {
        currentSentenceIndex++;
        if (podcastScriptSentences.length > 0) {
            const progress = (currentSentenceIndex / podcastScriptSentences.length) * 100;
            podcastProgressBarFill.style.width = `${progress}%`;
        }
        setTimeout(playPodcastSequence, 250);
    };

    utterance.onerror = (event) => {
        console.error('SpeechSynthesisUtterance.onerror', event);
        resetPodcast();
    };

    synth.speak(utterance);
}

function resetPodcast() {
    if (synth) {
        synth.cancel();
    }
    currentSentenceIndex = 0;
    podcastPlayPauseBtn.classList.remove('playing');
    podcastPlayPauseBtn.setAttribute('aria-label', 'Reproducir');
    podcastProgressBarFill.style.width = '0%';
    podcastTextDisplay.textContent = "Listo para reproducir. Presiona play.";
}

function dismissPodcast() {
    if (synth) {
        synth.cancel();
    }
    podcastPlayerContainer.classList.remove('visible');
    currentSentenceIndex = 0;
    podcastScriptSentences = [];
    podcastPlayPauseBtn.classList.remove('playing');
    podcastPlayPauseBtn.setAttribute('aria-label', 'Reproducir');
    podcastProgressBarFill.style.width = '0%';
    podcastDownloadBtn.onclick = null;
}


// --- HISTORY & DATABASE ---
async function getHistory(): Promise<SavedProject[]> {
    if (!currentUser) return [];
    try {
        const snapshot = await db.ref(`projects/${currentUser.username}`).once('value');
        const projects = snapshot.val();
        if (projects) {
            // Convert from object to array and sort by ID (newest first)
            // FIX: Explicitly cast the result of Object.values to SavedProject[] to satisfy TypeScript's type checking,
            // as snapshot.val() returns 'any' and Object.values() on 'any' returns 'unknown[]'.
            return (Object.values(projects) as SavedProject[]).sort((a, b) => b.id - a.id);
        }
        return [];
    } catch (e) {
        console.error("Failed to fetch project history:", e);
        return [];
    }
}

async function saveProjectToHistory(project: SavedProject) {
    if (!currentUser) return;
    try {
        await db.ref(`projects/${currentUser.username}/${project.id}`).set(project);
    } catch(e) {
        console.error("Failed to save project:", e);
    }
}

async function updateProjectInHistory(projectId: number, updates: Partial<SavedProject>) {
    if (!currentUser) return;
    try {
        await db.ref(`projects/${currentUser.username}/${projectId}`).update(updates);
    } catch (e) {
        console.error(`Failed to update project with ID ${projectId}:`, e);
    }
}

async function deleteProjectFromHistory(projectId: number) {
    if (!currentUser) return;
    try {
        await db.ref(`projects/${currentUser.username}/${projectId}`).remove();
        updateHistoryBadge();
    } catch(e) {
        console.error(`Failed to delete project with ID ${projectId}:`, e);
    }
}

async function updateHistoryBadge() {
    const projects = await getHistory();
    const count = projects.length;
    if (count > 0) {
        historyBadge.textContent = String(count);
        historyBadge.style.display = 'flex';
    } else {
        historyBadge.style.display = 'none';
    }
}

async function renderHistoryList() {
    historyListArea.innerHTML = `<p class="empty-history-message">Cargando proyectos...</p>`;
    const projects = await getHistory();

    historyListArea.innerHTML = ''; // Clear loading message

    if (projects.length === 0) {
        historyListArea.innerHTML = `<p class="empty-history-message">No tienes proyectos guardados. ¡Genera uno nuevo para empezar!</p>`;
        return;
    }

    projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'history-item-card';

        const info = document.createElement('div');
        info.className = 'history-item-info';
        info.innerHTML = `
            <h4>${escapeHtml(project.proposalName)}</h4>
            <p>
                <span><strong>Tema:</strong> ${escapeHtml(project.topic)}</span>
                <span><strong>Grado:</strong> ${escapeHtml(project.grade)}</span>
                <span><strong>Duración:</strong> ${escapeHtml(project.time)}</span>
            </p>
        `;

        const actions = document.createElement('div');
        actions.className = 'history-item-actions';
        
        const viewButton = document.createElement('button');
        viewButton.textContent = 'Ver Plan';
        viewButton.title = 'Ver el plan detallado de este proyecto';
        viewButton.onclick = () => {
            currentProjectData = null; 
            resetLogoPlaceholders();
            renderDetailedPlan(project.planMarkdown, project.proposalName, { fromHistory: true });
        };

        const editButton = document.createElement('button');
        editButton.textContent = 'Editar';
        editButton.title = 'Editar el contenido de este plan antes de imprimir';
        editButton.onclick = () => {
            currentProjectData = null;
            resetLogoPlaceholders();
            renderDetailedPlan(project.planMarkdown, project.proposalName, { isEditable: true, projectToEdit: project });
        };

        const feedbackButton = document.createElement('button');
        feedbackButton.className = 'feedback-button';
        if (project.feedback) {
            feedbackButton.textContent = '✓ Retroalimentación Enviada';
            feedbackButton.classList.add('completed');
            feedbackButton.disabled = true;
        } else {
            feedbackButton.textContent = 'Registrar Retroalimentación';
            feedbackButton.onclick = () => renderFeedbackForm(project);
        }
        

        const deleteButton = document.createElement('button');
        deleteButton.className = 'delete-button';
        deleteButton.textContent = 'Borrar';
        deleteButton.title = 'Borrar este proyecto del historial';
        deleteButton.onclick = async () => {
            if (confirm(`¿Estás seguro de que quieres borrar el proyecto "${project.proposalName}"? Esta acción no se puede deshacer.`)) {
                await deleteProjectFromHistory(project.id);
                await renderHistoryList(); // Refresh the list
            }
        };

        actions.append(viewButton, editButton, feedbackButton, deleteButton);
        card.append(info, actions);
        historyListArea.appendChild(card);
    });
}

// --- FEEDBACK ---
function renderFeedbackForm(project: SavedProject) {
    feedbackSection.innerHTML = `
        <h3 class="section-heading">Retroalimentación del Proyecto</h3>
        <form id="feedback-form">
            <h4>${escapeHtml(project.proposalName)}</h4>
            <div class="form-group">
                <label>¿Cómo calificarías la utilidad de este plan de clases?</label>
                <div class="rating-stars">
                    <span class="star" data-value="1">★</span>
                    <span class="star" data-value="2">★</span>
                    <span class="star" data-value="3">★</span>
                    <span class="star" data-value="4">★</span>
                    <span class="star" data-value="5">★</span>
                </div>
            </div>
            <div class="form-group">
                <label for="went-well">¿Qué funcionó bien durante la implementación?</label>
                <textarea id="went-well" required></textarea>
            </div>
            <div class="form-group">
                <label for="could-improve">¿Qué podría mejorarse en este plan?</label>
                <textarea id="could-improve" required></textarea>
            </div>
            <div class="feedback-actions">
                <button type="button" class="cancel">Cancelar</button>
                <button type="submit" class="submit">Enviar Retroalimentación</button>
            </div>
        </form>
    `;
    
    const form = feedbackSection.querySelector('#feedback-form') as HTMLFormElement;
    const stars = Array.from(feedbackSection.querySelectorAll('.star')) as HTMLElement[];
    let currentRating = 0;

    const setRating = (rating: number) => {
        currentRating = rating;
        stars.forEach(star => {
            star.classList.toggle('selected', parseInt(star.dataset.value!) <= rating);
        });
    };

    stars.forEach(star => {
        star.addEventListener('click', () => setRating(parseInt(star.dataset.value!)));
        star.addEventListener('mouseover', () => {
            stars.forEach(s => s.classList.remove('hovered'));
            for (let i = 0; i < parseInt(star.dataset.value!); i++) {
                stars[i].classList.add('hovered');
            }
        });
        star.addEventListener('mouseout', () => {
            stars.forEach(s => s.classList.remove('hovered'));
        });
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const wentWell = (document.getElementById('went-well') as HTMLTextAreaElement).value;
        const couldImprove = (document.getElementById('could-improve') as HTMLTextAreaElement).value;
        if (currentRating > 0 && wentWell && couldImprove) {
            const feedback: ProjectFeedback = {
                rating: currentRating,
                wentWell,
                couldImprove,
            };
            await updateProjectInHistory(project.id, { feedback });
            alert('¡Gracias por tu retroalimentación!');
            await renderHistoryList();
            showView('history');
        } else {
            alert('Por favor completa todos los campos, incluyendo la calificación.');
        }
    });

    form.querySelector('.cancel')?.addEventListener('click', () => showView('history'));

    showView('feedback');
}

// --- UTILITY FUNCTIONS ---
function resetLogoPlaceholders() {
    const placeholders = [
        { id: 'logo-right', inputId: 'logo-right-input' }
    ];

    placeholders.forEach(({ id, inputId }) => {
        const placeholder = document.getElementById(id);
        const input = document.getElementById(inputId) as HTMLInputElement | null;

        if (placeholder) {
            placeholder.style.backgroundImage = '';
            placeholder.style.border = ''; // Reverts to CSS default (dashed)
            const span = placeholder.querySelector('span');
            if (span) span.style.display = 'block';
        }
        if (input) {
            input.value = ''; // Clear file selection so 'change' fires again for the same file
        }
    });
}

function setupPdfModal(proposalName: string, printButton: HTMLButtonElement) {
    const modal = document.getElementById('pdf-info-modal')! as HTMLElement;
    const modalForm = document.getElementById('pdf-info-form')! as HTMLFormElement;
    const cancelBtn = document.getElementById('cancel-pdf-button')!;
    const teacherInput = document.getElementById('teacher-name')! as HTMLInputElement;
    const schoolInput = document.getElementById('school-name')! as HTMLInputElement;

    printButton.onclick = () => {
        modal.classList.add('visible');
    };

    cancelBtn.onclick = () => {
        modal.classList.remove('visible');
    };

    modal.onclick = (event) => {
        if (event.target === modal) {
            modal.classList.remove('visible');
        }
    }

    modalForm.onsubmit = async (event) => {
        event.preventDefault();
        const teacherName = teacherInput.value.trim();
        const schoolName = schoolInput.value.trim();
        
        if (teacherName && schoolName) {
            modal.classList.remove('visible');
            await generatePdfWithInfo(proposalName, printButton, teacherName, schoolName);
            modalForm.reset();
        }
    };
}

async function generatePdfWithInfo(proposalName: string, printButton: HTMLButtonElement, teacherName: string, schoolName: string) {
    printButton.disabled = true;
    printButton.textContent = '📄 Generando PDF...';

    const elementToPrint = document.getElementById('printable-area')!;
    const accordionContainer = document.getElementById('plan-accordion-container')!;

    const allStrongElements = elementToPrint.querySelectorAll('.content-wrapper strong');
    let teacherElement: HTMLElement | null = null;
    let schoolElement: HTMLElement | null = null;

    allStrongElements.forEach(strong => {
        const text = strong.textContent || '';
        if (text.includes('Docente(s) Responsable(s)')) {
            teacherElement = strong.parentElement; 
        }
        if (text.includes('Institución Educativa')) {
            schoolElement = strong.parentElement;
        }
    });

    const originalTeacherHTML = teacherElement ? teacherElement.innerHTML : '';
    const originalSchoolHTML = schoolElement ? schoolElement.innerHTML : '';

    if (teacherElement) {
        teacherElement.innerHTML = `<strong>Docente(s) Responsable(s):</strong> ${escapeHtml(teacherName)}`;
    }
    if (schoolElement) {
        schoolElement.innerHTML = `<strong>Institución Educativa:</strong> ${escapeHtml(schoolName)}`;
    }
    
    accordionContainer.classList.add('printing');
    await new Promise(resolve => requestAnimationFrame(resolve));

    const safeFilename = proposalName.replace(/[^a-z0-9\s-]/gi, '').replace(/\s+/g, '-').toLowerCase();
    const opt = {
      margin:       [0.25, 0.5, 0.75, 0.5],
      filename:     `${safeFilename}-plan-proyecto.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 3, logging: false, useCORS: true, windowHeight: elementToPrint.scrollHeight },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' },
      pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
    };

    try {
        await html2pdf().set(opt).from(elementToPrint).save();
    } catch (e) {
        console.error("Error generating PDF:", e);
        alert("Hubo un error al generar el PDF.");
    } finally {
        accordionContainer.classList.remove('printing');
        if (teacherElement) teacherElement.innerHTML = originalTeacherHTML;
        if (schoolElement) schoolElement.innerHTML = originalSchoolHTML;
        printButton.disabled = false;
        printButton.textContent = '🖨️ Imprimir / Guardar PDF';
    }
}

function applyMarkdown(markdownText: string): string {
    let html = markdownText;

    html = html.replace(/^#{1,6}\s+(.*)$/gm, (match, content) => {
        const level = match.match(/^#+/)?.[0].length || 0;
        return `<h${level}>${content.trim()}</h${level}>`;
    });
    
    html = html.replace(/\*\*(.*?)\*\*|__(.*?)__/g, '<strong>$1$2</strong>');
    html = html.replace(/\*(.*?)\*|_(.*?)_/g, '<em>$1$2</em>');
    html = html.replace(/~~(.*?)~~/g, '<del>$1</del>');
    
    html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, (match, lang, code) => {
        const escapedCode = escapeHtml(code);
        return `<pre><code class="language-${lang || ''}">${escapedCode.trim()}</code></pre>`;
    });
    html = html.replace(/`([^`]+)`/g, (match, code) => `<code>${escapeHtml(code)}</code>`);

    html = html.replace(/^([\s]*)(?:[-\*\+])\s+([\s\S]*?)(?=\n^\1(?:[-\*\+]|\d+\.)\s+|\n\n|$)/gm, (match, indent, itemContent) => {
        return `${indent}<li>${itemContent.trim().replace(/\n^\1\s*/gm, '<br>')}</li>`;
    });
    html = html.replace(/^([\s]*)(\d+)\.\s+([\s\S]*?)(?=\n^\1(?:\d+\.|[-\*\+])\s+|\n\n|$)/gm, (match, indent, num, itemContent) => {
        return `${indent}<li>${itemContent.trim().replace(/\n^\1\s*/gm, '<br>')}</li>`;
    });

    html = html.replace(/^(<li>[\s\S]*?<\/li>\s*)+/gm, (match) => {
        if (match.match(/^\s*<li>/)) {
            return `<ul>\n${match.trim()}\n</ul>`;
        }
        return match;
    });

    const parts = html.split(/(<pre(?:.|\n)*?<\/pre>|<ul(?:.|\n)*?<\/ul>|<ol(?:.|\n)*?<\/ol>)/i);
    html = parts.map((part, index) => {
        if (index % 2 === 1) return part;
        return part.replace(/\n/g, '<br>');
    }).join('');

    html = html.replace(/<br\s*\/?>\s*(<(?:h[1-6]|ul|ol|li|pre|blockquote|p|div))/gi, '$1');
    html = html.replace(/(<\/(?:h[1-6]|ul|ol|li|pre|blockquote|p|div)>)\s*<br\s*\/?>/gi, '$1');
    html = html.replace(/(<br\s*\/?>\s*){2,}/gi, '<br><br>');
    
    return html;
}

function displayError(message: string, container?: HTMLElement) {
    const targetContainer = container || proposalsSection || document.body;
    let viewToRestore: AppView = 'form';
    if(targetContainer === proposalsSection) viewToRestore = 'form';
    if(targetContainer === detailedPlanSection) viewToRestore = 'proposals';

    const errorElement = document.createElement('div');
    errorElement.className = 'error-message-critical';
    errorElement.textContent = message;
    
    // Clear the container and add the error
    targetContainer.innerHTML = '';
    targetContainer.appendChild(errorElement);
    
    showView(viewToRestore); // Go back to a safe state
}

function escapeHtml(unsafe: string): string {
    if (!unsafe) return '';
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// --- AUTHENTICATION & FIREBASE ---
function switchAuthTab(tab: 'login' | 'register') {
    authErrorMsg.textContent = '';
    if (tab === 'login') {
        loginTabBtn.classList.add('active');
        registerTabBtn.classList.remove('active');
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
    } else {
        loginTabBtn.classList.remove('active');
        registerTabBtn.classList.add('active');
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
    }
}

// Helper to sanitize username for Firebase path
function sanitizeUsername(username: string): string {
    return username.replace(/[.#$[\]]/g, '_');
}

async function handleLogin(event: Event) {
    event.preventDefault();
    authErrorMsg.textContent = '';
    const formData = new FormData(loginForm);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    const sanitizedUser = sanitizeUsername(username);

    try {
        const snapshot = await db.ref(`users/${sanitizedUser}`).once('value');
        const user = snapshot.val();

        if (user && user.password === password) {
            currentUser = { username: sanitizedUser };
            sessionStorage.setItem('mentorStemCurrentUser', JSON.stringify(currentUser));
            await updateHistoryBadge();
            showView('form');
        } else {
            authErrorMsg.textContent = 'Usuario o contraseña incorrectos.';
        }
    } catch(e) {
        console.error("Login error:", e);
        authErrorMsg.textContent = 'Error al conectar con la base de datos.';
    }
}

async function handleRegister(event: Event) {
    event.preventDefault();
    authErrorMsg.textContent = '';
    const formData = new FormData(registerForm);
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    if (!username || !password) {
        authErrorMsg.textContent = 'Por favor completa todos los campos.';
        return;
    }

    const sanitizedUser = sanitizeUsername(username);

    try {
        const snapshot = await db.ref(`users/${sanitizedUser}`).once('value');
        if (snapshot.exists()) {
            authErrorMsg.textContent = 'Este nombre de usuario ya existe.';
            return;
        }

        const newUser: User = { username: sanitizedUser, password };
        await db.ref(`users/${sanitizedUser}`).set(newUser);
        
        // Automatically log in the new user
        currentUser = { username: sanitizedUser };
        sessionStorage.setItem('mentorStemCurrentUser', JSON.stringify(currentUser));
        await updateHistoryBadge();
        showView('form');

    } catch(e) {
        console.error("Registration error:", e);
        authErrorMsg.textContent = 'Error al registrar el usuario.';
    }
}

function handleLogout() {
    currentUser = null;
    sessionStorage.removeItem('mentorStemCurrentUser');
    showView('login');
}

async function checkLoginState() {
    const userJson = sessionStorage.getItem('mentorStemCurrentUser');
    if (userJson) {
        currentUser = JSON.parse(userJson);
        await updateHistoryBadge();
        showView('form');
    } else {
        showView('login');
    }
}

// --- APP START ---
document.addEventListener('DOMContentLoaded', init);