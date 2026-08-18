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
  readonly selectionCount: (selected: number, rating: number) => string;
  readonly chooseFormat: string;
  readonly minimumFacts: (minimum: number) => string;
  readonly formatHeading: string;
  readonly formatLead: string;
  readonly formatLegend: string;
  readonly formatMeta: string;
  readonly writeDraft: string;
  readonly chooseAFormat: string;
  readonly formatChosen: string;
  readonly generatingHeading: string;
  readonly checkingDraft: string;
  readonly safeOutputOnly: string;
  readonly resultEyebrow: string;
  readonly resultHeading: string;
  readonly resultLead: string;
  readonly editLabel: string;
  readonly characters: (count: number) => string;
  readonly provenance: (count: number) => string;
  readonly copy: string;
  readonly readyToCopy: string;
  readonly copied: string;
  readonly manualCopy: string;
  readonly copyFootnote: string;
  readonly failureHeading: string;
  readonly failureBody: string;
  readonly retry: string;
  readonly guarded: string;
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
  selectionCount: (selected, rating) =>
    `${selected} selected · rating ${rating} of 5`,
  chooseFormat: "Choose a format",
  minimumFacts: (minimum) =>
    `Pick at least ${minimum} things. The assistant will not invent the rest.`,
  formatHeading: "Pick a format",
  formatLead: "Formats this business has enabled, for what you are doing.",
  formatLegend: "How should your review read?",
  formatMeta: "Review format",
  writeDraft: "Write the draft",
  chooseAFormat: "Choose at least one format.",
  formatChosen: "1 format chosen.",
  generatingHeading: "Creating your review",
  checkingDraft: "Checking your draft…",
  safeOutputOnly: "Only supported wording will appear in the result.",
  resultEyebrow: "Your draft",
  resultHeading: "Here it is",
  resultLead:
    "Change anything you like. Nothing leaves this page until you copy it yourself.",
  editLabel: "Your draft — edit it freely",
  characters: (count) => `${count} characters`,
  provenance: (count) =>
    `What this draft is built on (${count} facts, each traceable)`,
  copy: "Copy",
  readyToCopy: "Ready to copy.",
  copied: "Copied",
  manualCopy: "Select the review text and copy it manually.",
  copyFootnote:
    "Copying puts the text on your clipboard. Nothing is submitted from here.",
  failureHeading: "We couldn't create a draft",
  failureBody: "No review text was saved. You can try again or write it yourself.",
  retry: "Try again",
  guarded: "grounded",
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
  selectionCount: (selected, rating) =>
    `${selected} ausgewählt · Bewertung ${rating} von 5`,
  chooseFormat: "Format wählen",
  minimumFacts: (minimum) =>
    `Wählen Sie mindestens ${minimum} Punkte. Der Assistent erfindet den Rest nicht.`,
  formatHeading: "Format wählen",
  formatLead: "Formate, die dieses Haus für diese Aktion freigegeben hat.",
  formatLegend: "Wie soll Ihre Bewertung klingen?",
  formatMeta: "Bewertungsformat",
  writeDraft: "Entwurf schreiben",
  chooseAFormat: "Wählen Sie mindestens ein Format.",
  formatChosen: "1 Format ausgewählt.",
  generatingHeading: "Ihre Bewertung wird erstellt",
  checkingDraft: "Entwurf wird geprüft…",
  safeOutputOnly: "Im Ergebnis erscheinen nur belegte Formulierungen.",
  resultEyebrow: "Ihr Entwurf",
  resultHeading: "Hier ist er",
  resultLead:
    "Ändern Sie alles, was Sie möchten. Nichts verlässt diese Seite, bis Sie es selbst kopieren.",
  editLabel: "Ihr Entwurf — frei bearbeitbar",
  characters: (count) => `${count} Zeichen`,
  provenance: (count) =>
    `Worauf dieser Entwurf beruht (${count} belegte Fakten)`,
  copy: "Kopieren",
  readyToCopy: "Bereit zum Kopieren.",
  copied: "Kopiert",
  manualCopy: "Markieren und kopieren Sie den Text manuell.",
  copyFootnote:
    "Beim Kopieren wird der Text in die Zwischenablage gelegt. Von hier wird nichts veröffentlicht.",
  failureHeading: "Der Entwurf konnte nicht erstellt werden",
  failureBody:
    "Es wurde kein Bewertungstext gespeichert. Sie können es erneut versuchen oder selbst schreiben.",
  retry: "Erneut versuchen",
  guarded: "belegt",
};

export function getSurveyCopy(locale: string): SurveyCopy {
  return locale === "de-DE" ? german : english;
}
