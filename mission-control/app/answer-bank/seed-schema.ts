/**
 * seed-schema — declarative wizard rows for the Profile Seed Pack.
 *
 * The Profile Seed Pack (Phase 4h) is a one-time setup wizard that
 * pre-populates the answer bank with the standard fields every job
 * application asks. After ~5 minutes of setup, an 11-field Greenhouse
 * form should flip from "Known: 4 / Unknown: 7" to nearly all known.
 *
 * This file is the SCHEMA, not the data. The data lives in the bank
 * — each completed wizard row writes a `BankEntry` via the standard
 * POST /api/answer-bank flow.
 *
 * Each row declares:
 *   - question: canonical phrasing the bank stores
 *   - aliases: generous list covering Greenhouse / Lever / Workday /
 *     Ashby / Greenhouse / iCIMS phrasings — this is what makes
 *     fuzzy-match catch every variant
 *   - category: bank category for grouping in the management UI
 *   - type: smart-type discriminator
 *   - sensitive: render hint for masked display in the UI
 *   - placeholder / hint: UI affordances for the wizard
 *   - default: optional initial value
 *
 * For singleChoice rows, `options` is the canonical enum (worker
 * uses fuzzy-match to map "Male" → "Male - Cisgender" etc.). For
 * range rows, `min` / `max` / `fallback` ride the `range` payload.
 */

import type {
  AnswerCategory,
  AnswerType,
  RangePayload,
  SingleChoicePayload,
  TemplatePayload,
  AiPromptPayload,
  FormulaPayload,
} from '@/lib/apply-worker/answer-bank-client'

export interface SeedRow {
  /** Stable id used by the wizard to track per-row save state. */
  key: string
  question: string
  aliases: string[]
  category: AnswerCategory
  type: AnswerType
  sensitive?: boolean
  /** UI label shown above the input. */
  label: string
  /** Optional helper text under the input. */
  hint?: string
  /** Optional placeholder for the input. */
  placeholder?: string
  /** Optional default value for text/template/formula types. */
  defaultValue?: string
  /** Default range payload for type='range'. */
  defaultRange?: RangePayload
  /** Default singleChoice payload for type='singleChoice'. */
  defaultSingleChoice?: SingleChoicePayload
  /** Default template payload for type='template'. */
  defaultTemplate?: TemplatePayload
  /** Default aiPrompt payload for type='aiPrompt'. */
  defaultAiPrompt?: AiPromptPayload
  /** Default formula payload for type='formula'. */
  defaultFormula?: FormulaPayload
}

export interface SeedSection {
  id: string
  title: string
  description: string
  rows: SeedRow[]
}

// ---- Contact ------------------------------------------------------------

const CONTACT: SeedSection = {
  id: 'contact',
  title: 'Contact',
  description:
    'The basics every form asks. Once filled, every Greenhouse / Lever / Workday form auto-completes the contact section in one pass.',
  rows: [
    {
      key: 'fullName',
      question: 'Full name',
      aliases: ['name', 'full name', 'your name', 'applicant name', 'legal name'],
      category: 'contact',
      type: 'text',
      label: 'Full name',
      placeholder: 'Mike Cutillo',
    },
    {
      key: 'firstName',
      question: 'First name',
      aliases: ['first name', 'given name', 'preferred first name'],
      category: 'contact',
      type: 'text',
      label: 'First name',
      placeholder: 'Mike',
    },
    {
      key: 'lastName',
      question: 'Last name',
      aliases: ['last name', 'surname', 'family name'],
      category: 'contact',
      type: 'text',
      label: 'Last name',
      placeholder: 'Cutillo',
    },
    {
      key: 'email',
      question: 'Email address',
      aliases: ['email', 'email address', 'e-mail', 'work email', 'contact email'],
      category: 'contact',
      type: 'text',
      label: 'Email',
      placeholder: 'you@example.com',
    },
    {
      key: 'phone',
      question: 'Phone number',
      aliases: ['phone', 'phone number', 'mobile', 'cell phone', 'contact number'],
      category: 'contact',
      type: 'text',
      label: 'Phone',
      placeholder: '+1 555 555 5555',
    },
    {
      key: 'city',
      question: 'Current city',
      aliases: ['city', 'current city', 'city of residence', 'where are you located'],
      category: 'contact',
      type: 'text',
      label: 'Current city',
    },
    {
      key: 'state',
      question: 'Current state',
      aliases: ['state', 'current state', 'state of residence', 'state/province'],
      category: 'contact',
      type: 'text',
      label: 'Current state',
    },
    {
      key: 'zip',
      question: 'Postal code',
      aliases: ['zip', 'zip code', 'postal code', 'postcode'],
      category: 'contact',
      type: 'text',
      label: 'Postal code',
    },
    {
      key: 'country',
      question: 'Country',
      aliases: ['country', 'country of residence'],
      category: 'contact',
      type: 'text',
      label: 'Country',
      defaultValue: 'United States',
    },
    {
      key: 'linkedin',
      question: 'LinkedIn URL',
      aliases: [
        'linkedin',
        'linkedin url',
        'linkedin profile',
        'linkedin or professional website',
        'linkedin profile url',
        'professional website',
        'professional profile',
      ],
      category: 'contact',
      type: 'text',
      label: 'LinkedIn URL',
      hint: 'The exact gap from the ClickUp screenshot — fill this once and never see it again.',
      placeholder: 'https://linkedin.com/in/yourname',
    },
    {
      key: 'github',
      question: 'GitHub URL',
      aliases: ['github', 'github url', 'github profile', 'github username'],
      category: 'contact',
      type: 'text',
      label: 'GitHub URL',
      placeholder: 'https://github.com/yourname',
    },
    {
      key: 'portfolio',
      question: 'Portfolio URL',
      aliases: [
        'portfolio',
        'portfolio url',
        'personal website',
        'website',
        'portfolio or personal website',
      ],
      category: 'contact',
      type: 'text',
      label: 'Portfolio / personal website',
      placeholder: 'https://your-domain.com',
    },
  ],
}

// ---- Authorization ------------------------------------------------------

const AUTH: SeedSection = {
  id: 'auth',
  title: 'Work authorization & relocation',
  description:
    'Yes/No questions every applicant tracking system asks. Answering once lets the worker fly past the first 4 dropdowns of any application.',
  rows: [
    {
      key: 'workAuth',
      question: 'Are you legally authorized to work in the United States?',
      aliases: [
        'work authorization',
        'authorized to work in the us',
        'legally authorized to work',
        'eligible to work in the united states',
        'are you authorized to work',
        'work eligibility',
      ],
      category: 'auth',
      type: 'singleChoice',
      label: 'Authorized to work in the US?',
      defaultSingleChoice: {
        options: ['Yes', 'No'],
        selected: 'Yes',
      },
    },
    {
      key: 'sponsorship',
      question: 'Will you now or in the future require sponsorship for employment visa status?',
      aliases: [
        'sponsorship',
        'visa sponsorship',
        'require sponsorship',
        'will you require sponsorship',
        'need work visa',
        'h1b sponsorship',
      ],
      category: 'auth',
      type: 'singleChoice',
      label: 'Need visa sponsorship?',
      defaultSingleChoice: {
        options: ['Yes', 'No'],
        selected: 'No',
      },
    },
    {
      key: 'relocation',
      question: 'Are you willing to relocate?',
      aliases: [
        'relocation',
        'willing to relocate',
        'open to relocation',
        'relocation possible',
      ],
      category: 'auth',
      type: 'singleChoice',
      label: 'Willing to relocate?',
      defaultSingleChoice: {
        options: ['Yes', 'No'],
        selected: 'No',
      },
    },
    {
      key: 'remote',
      question: 'Are you open to remote work?',
      aliases: [
        'remote',
        'remote work',
        'open to remote',
        'work remotely',
        'remote ok',
      ],
      category: 'auth',
      type: 'singleChoice',
      label: 'Open to remote work?',
      defaultSingleChoice: {
        options: ['Yes', 'No'],
        selected: 'Yes',
      },
    },
  ],
}

// ---- EEOC self-identification -----------------------------------------

const EEOC: SeedSection = {
  id: 'eeoc',
  title: 'EEOC self-identification',
  description:
    'Standard demographic fields every US employer asks. Marked sensitive — answers are masked in the management UI by default.',
  rows: [
    {
      key: 'gender',
      question: 'Gender',
      aliases: [
        'gender',
        'what is your gender',
        'gender identity',
        'how do you identify',
      ],
      category: 'sensitive',
      type: 'singleChoice',
      sensitive: true,
      label: 'Gender',
      defaultSingleChoice: {
        options: [
          'Male',
          'Female',
          'Non-binary',
          'Decline to self-identify',
        ],
        selected: 'Decline to self-identify',
      },
    },
    {
      key: 'ethnicity',
      question: 'Race / ethnicity',
      aliases: [
        'race',
        'ethnicity',
        'race/ethnicity',
        'race or ethnicity',
        'hispanic or latino',
        'ethnic background',
      ],
      category: 'sensitive',
      type: 'singleChoice',
      sensitive: true,
      label: 'Race / ethnicity',
      defaultSingleChoice: {
        options: [
          'White',
          'Black or African American',
          'Hispanic or Latino',
          'Asian',
          'Native Hawaiian or Other Pacific Islander',
          'American Indian or Alaska Native',
          'Two or More Races',
          'Decline to self-identify',
        ],
        selected: 'Decline to self-identify',
      },
    },
    {
      key: 'veteran',
      question: 'Veteran status',
      aliases: [
        'veteran',
        'veteran status',
        'protected veteran',
        'are you a veteran',
        'military service',
      ],
      category: 'sensitive',
      type: 'singleChoice',
      sensitive: true,
      label: 'Veteran status',
      defaultSingleChoice: {
        options: [
          'I am not a protected veteran',
          'I identify as one or more of the classifications of a protected veteran',
          'I do not wish to self-identify',
        ],
        selected: 'I do not wish to self-identify',
      },
    },
    {
      key: 'disability',
      question: 'Disability status',
      aliases: [
        'disability',
        'disability status',
        'do you have a disability',
        'disabled',
        'self-identify disability',
      ],
      category: 'sensitive',
      type: 'singleChoice',
      sensitive: true,
      label: 'Disability status',
      defaultSingleChoice: {
        options: [
          'Yes, I have a disability (or previously had a disability)',
          'No, I do not have a disability',
          'I do not wish to answer',
        ],
        selected: 'I do not wish to answer',
      },
    },
  ],
}

// ---- Compensation -------------------------------------------------------

const COMP: SeedSection = {
  id: 'comp',
  title: 'Compensation',
  description:
    'Set your salary range once. Single-field forms get the midpoint; split min/max forms get both. Update here when your target changes — every future apply uses the new value.',
  rows: [
    {
      key: 'salary',
      question: 'Desired salary range',
      aliases: [
        'expected salary',
        'target salary',
        'salary expectation',
        'salary expectations',
        'compensation expectation',
        'desired salary',
        'desired salary range',
        'what is your desired salary range',
        'salary requirements',
        'minimum salary',
        'what are your salary expectations',
        'annual base salary',
        'desired compensation',
        'base salary',
      ],
      category: 'sensitive',
      type: 'range',
      sensitive: true,
      label: 'Desired salary range (USD)',
      hint: 'Worker fills the midpoint into single fields and both ends into split min/max forms.',
      defaultRange: {
        min: 180000,
        max: 220000,
        fallback: 'mid',
      },
    },
  ],
}

// ---- Availability -------------------------------------------------------

const AVAIL: SeedSection = {
  id: 'availability',
  title: 'Availability',
  description:
    'Start date and notice period. Formula entries auto-update — "today + 14 days" always means "two weeks out from now," no maintenance.',
  rows: [
    {
      key: 'startDate',
      question: 'Earliest start date',
      aliases: [
        'start date',
        'earliest start date',
        'when can you start',
        'available to start',
        'availability',
        'when are you available',
      ],
      category: 'preference',
      type: 'formula',
      label: 'Earliest start date',
      hint: 'Date formula. Example: "today + 14 days" or "today + 4 weeks".',
      defaultFormula: { expr: 'today + 14 days' },
    },
    {
      key: 'notice',
      question: 'Notice period',
      aliases: [
        'notice period',
        'how much notice',
        'notice required',
        'current notice period',
      ],
      category: 'preference',
      type: 'text',
      label: 'Notice period',
      placeholder: '2 weeks',
      defaultValue: '2 weeks',
    },
  ],
}

// ---- Qualitative templates ---------------------------------------------

const QUAL: SeedSection = {
  id: 'qualitative',
  title: 'Qualitative answers (AI-generated per job)',
  description:
    'These questions are different on every job. Claude generates a per-application draft using your profile + the job description; you click Save in the popup to make it permanent. Cached per company so the same answer reuses the same draft.',
  rows: [
    {
      key: 'whyCompany',
      question: 'Why are you interested in this company?',
      aliases: [
        'why this company',
        'why are you interested',
        'why us',
        'why do you want to work here',
        'why are you applying',
        'what excites you about',
      ],
      category: 'qualitative',
      type: 'aiPrompt',
      label: 'Why this company?',
      hint: 'Cached per-company so the second apply at the same place reuses the draft.',
      defaultAiPrompt: {
        prompt:
          'Write a 2-3 sentence answer in Mike\'s voice explaining why he is interested in {{company}}, using a real product, value, or initiative from the job description.',
        cachePerCompany: true,
      },
    },
    {
      key: 'recentProject',
      question: 'Tell us about a recent project',
      aliases: [
        'recent project',
        'tell us about a project',
        'describe a recent project',
        'what have you been working on',
      ],
      category: 'qualitative',
      type: 'aiPrompt',
      label: 'Recent project',
      defaultAiPrompt: {
        prompt:
          'Write a 3-4 sentence summary of a recent technical project Mike has worked on, drawing from his profile facts. Highlight measurable impact.',
        cachePerCompany: false,
      },
    },
    {
      key: 'whyRole',
      question: 'Why are you a good fit for this role?',
      aliases: [
        'why are you a good fit',
        'why this role',
        'why should we hire you',
        'what makes you a good fit',
      ],
      category: 'qualitative',
      type: 'aiPrompt',
      label: 'Why this role?',
      defaultAiPrompt: {
        prompt:
          'Write a 2-3 sentence answer explaining why Mike is a strong fit for {{role}} at {{company}}, using specific keywords from the job description.',
        cachePerCompany: true,
      },
    },
  ],
}

// ---- Export -------------------------------------------------------------

export const SEED_SECTIONS: SeedSection[] = [
  CONTACT,
  AUTH,
  EEOC,
  COMP,
  AVAIL,
  QUAL,
]

/**
 * Flatten the schema for convenience — useful when checking
 * "is this row already in the bank?" by question/alias match.
 */
export function allSeedRows(): SeedRow[] {
  return SEED_SECTIONS.flatMap((s) => s.rows)
}
