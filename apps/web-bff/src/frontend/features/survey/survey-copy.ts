export interface SurveyCopy {
  readonly reviewLabel: string;
  readonly assistantLabel: string;
  readonly openVisit: string;
  readonly invitedVisit: string;
  readonly ask: (business: string) => string;
  readonly acknowledgement: (location: string) => string;
  readonly ratingAsk: string;
  readonly ratingGroupLabel: string;
  readonly chooseRating: string;
  readonly ratingWords: readonly [string, string, string, string, string];
  readonly trust: string;
  readonly generatePath: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly paraphrasePath: {
    readonly eyebrow: string;
    readonly title: string;
    readonly body: string;
    readonly cta: string;
  };
  readonly needRating: string;
  readonly choosePath: string;
  readonly writingPathLabel: string;
  readonly assistanceUnavailable: string;
  readonly startFailed: string;
  readonly factsEyebrow: string;
  readonly factsHeading: string;
  readonly factsLead: string;
  readonly optionalFactLabel: string;
  readonly optionalFactHelp: (maximum: number) => string;
  readonly selectionCount: (selected: number, rating: number) => string;
  readonly chooseFormat: string;
  readonly minimumFacts: (minimum: number) => string;
  readonly formatHeading: string;
  readonly formatLead: string;
  readonly formatLegend: string;
  readonly formatMeta: string;
  readonly formatConstraints: (minimum: number, maximum: number) => string;
  readonly writeDraft: string;
  readonly chooseAFormat: string;
  readonly formatChosen: string;
  readonly generatingHeading: string;
  readonly checkingDraft: string;
  readonly progress: (
    phase: "queued" | "generating" | "validating" | "persisting",
    elapsedSeconds: number,
  ) => string;
  readonly stopGeneration: string;
  readonly safeOutputOnly: string;
  readonly resultEyebrow: string;
  readonly resultHeading: string;
  readonly resultLead: string;
  readonly actionLabel: (action: "generate" | "paraphrase") => string;
  readonly editLabel: string;
  readonly characters: (count: number) => string;
  readonly charactersAgainstLimit: (count: number, maximum: number) => string;
  readonly editedByYou: string;
  readonly formatWarning: (minimum: number, maximum: number) => string;
  readonly provenance: (count: number) => string;
  readonly copy: string;
  readonly readyToCopy: string;
  readonly reworkLabel: string;
  readonly tryAgain: string;
  readonly tryAnotherFormat: string;
  readonly changeWhatYouSaid: string;
  readonly reworkNote: string;
  readonly copied: string;
  readonly manualCopy: string;
  readonly copyFootnote: string;
  readonly failureHeading: string;
  readonly failureBody: string;
  readonly cancelledHeading: string;
  readonly cancelledBody: string;
  readonly rateLimitedHeading: string;
  readonly rateLimitedBody: string;
  readonly budgetHeading: string;
  readonly budgetBody: string;
  readonly groundingHeading: string;
  readonly groundingBody: string;
  readonly formatFailureHeading: string;
  readonly formatFailureBody: string;
  readonly changeFacts: string;
  readonly manualReviewLabel: string;
  readonly retry: string;
  readonly guarded: string;
  readonly doneEyebrow: string;
  readonly doneHeading: string;
  readonly doneLead: string;
  readonly copyAgain: string;
  readonly openDestination: (destination: string) => string;
  readonly backToEdit: string;
  readonly noDestination: string;
}

const english: SurveyCopy = {
  reviewLabel: "Review",
  assistantLabel: "Review assistant",
  openVisit: "Open visit",
  invitedVisit: "Invited visit",
  ask: (business) => `Write your review of ${business}`,
  acknowledgement: (location) => `You are at ${location}.`,
  ratingAsk: "How was it?",
  ratingGroupLabel: "Rating, 1 to 5",
  chooseRating: "Choose a rating to continue.",
  ratingWords: ["Poor", "Not good", "Mixed", "Good", "Very good"],
  trust:
    "You supply the facts. Everything on the next screens is a draft you read, change and copy yourself. Nothing is posted anywhere for you.",
  generatePath: {
    eyebrow: "Path one",
    title: "Help me write one",
    body: "Choose the things that actually happened. The draft is built only from those.",
    cta: "Pick what to mention",
  },
  paraphrasePath: {
    eyebrow: "Path two",
    title: "I have written one",
    body: "Paste your own review. Your facts stay exactly as you wrote them; only the wording changes.",
    cta: "Improve my wording",
  },
  needRating:
    "Choose a rating first. It sets the register of the draft, and it is the one thing the assistant will not decide for you.",
  choosePath: "Choose either path to continue.",
  writingPathLabel: "Writing path",
  assistanceUnavailable:
    "Review assistance is not configured for this location right now.",
  startFailed: "The review could not be started. Please try again.",
  factsEyebrow: "What happened",
  factsHeading: "What stood out?",
  factsLead:
    "Pick everything that actually happened. The order you pick them is the order they are written in.",
  optionalFactLabel: "Something else that happened (optional)",
  optionalFactHelp: (maximum) =>
    `Write only a fact you personally assert is true. Maximum ${maximum} characters.`,
  selectionCount: (selected, rating) =>
    `${selected} selected · rating ${rating} of 5`,
  chooseFormat: "Choose a format",
  minimumFacts: (minimum) =>
    `Pick at least ${minimum} things. The assistant will not invent the rest.`,
  formatHeading: "Pick a format",
  formatLead: "Formats this business has enabled, for what you are doing.",
  formatLegend: "How should your review read?",
  formatMeta: "Review format",
  formatConstraints: (minimum, maximum) => `${minimum}–${maximum} characters`,
  writeDraft: "Write the draft",
  chooseAFormat: "Choose at least one format.",
  formatChosen: "1 format chosen.",
  generatingHeading: "Creating your review",
  checkingDraft: "Checking your draft…",
  progress: (phase, elapsedSeconds) =>
    `${phase[0]?.toUpperCase()}${phase.slice(1)} · ${elapsedSeconds}s`,
  stopGeneration: "Stop generation",
  safeOutputOnly: "Only supported wording will appear in the result.",
  resultEyebrow: "Your draft",
  resultHeading: "Here it is",
  resultLead:
    "Change anything you like. Nothing leaves this page until you copy it yourself.",
  actionLabel: (action) => (action === "generate" ? "assisted draft" : "reworded"),
  editLabel: "Your draft — edit it freely",
  characters: (count) => `${count} characters`,
  charactersAgainstLimit: (count, maximum) => `${count} / ${maximum} characters`,
  editedByYou: "Edited by you",
  formatWarning: (minimum, maximum) =>
    `This format works best between ${minimum} and ${maximum} characters. You can still copy your own final wording.`,
  provenance: (count) =>
    `What this draft is built on (${count} facts, each traceable)`,
  copy: "Copy",
  readyToCopy: "Ready to copy.",
  reworkLabel: "Not quite right?",
  tryAgain: "Write it again",
  tryAnotherFormat: "Try another style",
  changeWhatYouSaid: "Change what you mentioned",
  reworkNote:
    "Writing it again uses the same points you confirmed, worded differently.",
  copied: "Copied",
  manualCopy: "Select the review text and copy it manually.",
  copyFootnote:
    "Copying puts the text on your clipboard. Nothing is submitted from here.",
  failureHeading: "We couldn't create a draft",
  failureBody: "No review text was saved. You can try again or write it yourself.",
  cancelledHeading: "Generation stopped",
  cancelledBody: "No partial review text was saved. Your choices are still here.",
  rateLimitedHeading: "A few too many requests",
  rateLimitedBody:
    "Your choices are still here. Wait a moment, then try the same request again.",
  budgetHeading: "Writing assistance is temporarily unavailable",
  budgetBody:
    "You can still write, copy and post your review yourself. Account or billing details are never shown here.",
  groundingHeading: "We need a little more detail",
  groundingBody:
    "The assistant could not support a safe draft from the selected facts. Add or change your facts and try again.",
  formatFailureHeading: "The selected format could not be satisfied",
  formatFailureBody:
    "Your choices are still here. Choose different wording or try again later.",
  changeFacts: "Change my facts",
  manualReviewLabel: "Write your review yourself",
  retry: "Try again",
  guarded: "grounded",
  doneEyebrow: "Ready to post",
  doneHeading: "Your review is ready",
  doneLead:
    "The text is on your clipboard. Open the review platform and submit it yourself when you are ready.",
  copyAgain: "Copy again",
  openDestination: (destination) => `Open ${destination}`,
  backToEdit: "Back to edit",
  noDestination:
    "This location has no posting destination for the selected format. Your review remains available to copy.",
};

const german: SurveyCopy = {
  ...english,
  reviewLabel: "Bewertung",
  assistantLabel: "Bewertungsassistent",
  openVisit: "Offener Besuch",
  invitedVisit: "Eingeladener Besuch",
  ask: (business) => `Bewerten Sie Ihren Besuch bei ${business}`,
  acknowledgement: (location) => `Sie sind bei ${location}.`,
  ratingAsk: "Wie war es?",
  ratingGroupLabel: "Bewertung von 1 bis 5",
  chooseRating: "Wählen Sie eine Bewertung, um fortzufahren.",
  ratingWords: ["Schlecht", "Nicht gut", "Gemischt", "Gut", "Sehr gut"],
  trust:
    "Die Fakten kommen von Ihnen. Alles Weitere ist ein Entwurf, den Sie lesen, ändern und selbst kopieren. Nichts wird für Sie veröffentlicht.",
  generatePath: {
    eyebrow: "Weg eins",
    title: "Hilf mir beim Schreiben",
    body: "Wählen Sie aus, was tatsächlich passiert ist. Der Entwurf entsteht nur daraus.",
    cta: "Auswählen, was erwähnt wird",
  },
  paraphrasePath: {
    eyebrow: "Weg zwei",
    title: "Ich habe schon etwas geschrieben",
    body: "Fügen Sie Ihren eigenen Text ein. Ihre Fakten bleiben genau so, wie Sie sie geschrieben haben — nur die Formulierung ändert sich.",
    cta: "Meine Formulierung verbessern",
  },
  needRating:
    "Wählen Sie zuerst eine Bewertung. Sie bestimmt den Ton des Entwurfs, und sie ist das Einzige, was der Assistent nicht für Sie entscheidet.",
  choosePath: "Wählen Sie einen Weg, um fortzufahren.",
  writingPathLabel: "Weg zum Entwurf",
  assistanceUnavailable:
    "Für diesen Standort ist die Bewertungsassistenz derzeit nicht eingerichtet.",
  startFailed:
    "Die Bewertung konnte nicht gestartet werden. Bitte versuchen Sie es erneut.",
  factsEyebrow: "Was passiert ist",
  factsHeading: "Was ist Ihnen aufgefallen?",
  factsLead:
    "Wählen Sie alles, was tatsächlich passiert ist. Die Reihenfolge Ihrer Auswahl ist die Reihenfolge im Text.",
  optionalFactLabel: "Etwas anderes, das passiert ist (optional)",
  optionalFactHelp: (maximum) =>
    `Schreiben Sie nur einen Fakt, dessen Wahrheit Sie selbst bestätigen. Maximal ${maximum} Zeichen.`,
  selectionCount: (selected, rating) =>
    `${selected} ausgewählt · Bewertung ${rating} von 5`,
  chooseFormat: "Format wählen",
  minimumFacts: (minimum) =>
    `Wählen Sie mindestens ${minimum} Punkte. Der Assistent erfindet den Rest nicht.`,
  formatHeading: "Format wählen",
  formatLead: "Formate, die dieses Haus für diese Aktion freigegeben hat.",
  formatLegend: "Wie soll Ihre Bewertung klingen?",
  formatMeta: "Bewertungsformat",
  formatConstraints: (minimum, maximum) => `${minimum}–${maximum} Zeichen`,
  writeDraft: "Entwurf schreiben",
  chooseAFormat: "Wählen Sie mindestens ein Format.",
  formatChosen: "1 Format ausgewählt.",
  generatingHeading: "Ihre Bewertung wird erstellt",
  checkingDraft: "Entwurf wird geprüft…",
  progress: (phase, elapsedSeconds) => {
    const phases = {
      queued: "Wartet",
      generating: "Wird erstellt",
      validating: "Wird geprüft",
      persisting: "Wird gespeichert",
    } as const;
    return `${phases[phase]} · ${elapsedSeconds}s`;
  },
  stopGeneration: "Erstellung stoppen",
  safeOutputOnly: "Im Ergebnis erscheinen nur belegte Formulierungen.",
  resultEyebrow: "Ihr Entwurf",
  resultHeading: "Hier ist er",
  resultLead:
    "Ändern Sie alles, was Sie möchten. Nichts verlässt diese Seite, bis Sie es selbst kopieren.",
  actionLabel: (action) =>
    action === "generate" ? "Schreibentwurf" : "neu formuliert",
  editLabel: "Ihr Entwurf — frei bearbeitbar",
  characters: (count) => `${count} Zeichen`,
  charactersAgainstLimit: (count, maximum) => `${count} / ${maximum} Zeichen`,
  editedByYou: "Von Ihnen bearbeitet",
  formatWarning: (minimum, maximum) =>
    `Dieses Format funktioniert am besten mit ${minimum} bis ${maximum} Zeichen. Ihren eigenen finalen Text können Sie trotzdem kopieren.`,
  provenance: (count) =>
    `Worauf dieser Entwurf beruht (${count} belegte Fakten)`,
  copy: "Kopieren",
  readyToCopy: "Bereit zum Kopieren.",
  reworkLabel: "Nicht ganz passend?",
  tryAgain: "Neu schreiben lassen",
  tryAnotherFormat: "Anderen Stil versuchen",
  changeWhatYouSaid: "Angaben ändern",
  reworkNote:
    "Beim Neuschreiben werden dieselben bestätigten Punkte anders formuliert.",
  copied: "Kopiert",
  manualCopy: "Markieren und kopieren Sie den Text manuell.",
  copyFootnote:
    "Beim Kopieren wird der Text in die Zwischenablage gelegt. Von hier wird nichts veröffentlicht.",
  failureHeading: "Der Entwurf konnte nicht erstellt werden",
  failureBody:
    "Es wurde kein Bewertungstext gespeichert. Sie können es erneut versuchen oder selbst schreiben.",
  cancelledHeading: "Erstellung gestoppt",
  cancelledBody:
    "Es wurde kein unvollständiger Bewertungstext gespeichert. Ihre Auswahl bleibt erhalten.",
  rateLimitedHeading: "Zu viele Anfragen in kurzer Zeit",
  rateLimitedBody:
    "Ihre Auswahl bleibt erhalten. Warten Sie einen Moment und versuchen Sie dieselbe Anfrage erneut.",
  budgetHeading: "Die Schreibhilfe ist vorübergehend nicht verfügbar",
  budgetBody:
    "Sie können Ihre Bewertung weiterhin selbst schreiben, kopieren und veröffentlichen. Konto- oder Abrechnungsdetails werden hier nicht angezeigt.",
  groundingHeading: "Wir brauchen etwas mehr Information",
  groundingBody:
    "Aus den ausgewählten Fakten konnte kein sicher belegter Entwurf entstehen. Ergänzen oder ändern Sie Ihre Fakten und versuchen Sie es erneut.",
  formatFailureHeading: "Das ausgewählte Format konnte nicht erfüllt werden",
  formatFailureBody:
    "Ihre Auswahl bleibt erhalten. Wählen Sie eine andere Formulierung oder versuchen Sie es später erneut.",
  changeFacts: "Fakten ändern",
  manualReviewLabel: "Bewertung selbst schreiben",
  retry: "Erneut versuchen",
  guarded: "belegt",
  doneEyebrow: "Bereit zum Veröffentlichen",
  doneHeading: "Ihre Bewertung ist bereit",
  doneLead:
    "Der Text ist in Ihrer Zwischenablage. Öffnen Sie die Bewertungsplattform und veröffentlichen Sie ihn selbst, wenn Sie bereit sind.",
  copyAgain: "Erneut kopieren",
  openDestination: (destination) => `${destination} öffnen`,
  backToEdit: "Weiter bearbeiten",
  noDestination:
    "Für das ausgewählte Format ist an diesem Standort kein Ziel hinterlegt. Ihre Bewertung kann weiterhin kopiert werden.",
};

export function getSurveyCopy(locale: string): SurveyCopy {
  return locale === "de-DE" ? german : english;
}
