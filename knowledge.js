// ---- Single source of truth: edit school info here ----
const school = {
  name: 'Thinkers Alliance School Bhakkar',
  city: 'Bhakkar',
  motto: 'I think, therefore I am',
  fees: { first: 50000, second: 100000, currency: 'PKR' },
  subjects: [
    { name: 'Physics', blurb: 'Mechanics, waves, electricity and modern physics.' },
    { name: 'Chemistry', blurb: 'Reactions, organic chemistry and lab practice.' },
    { name: 'Mathematics', blurb: 'Algebra, calculus and problem solving.' },
    { name: 'Biology', blurb: 'Life sciences from cells to ecosystems.' },
    { name: 'English', blurb: 'Reading, writing and confident communication.' },
    { name: 'Computer Science', blurb: 'Computing basics and digital skills.' }
  ],
  teachers: {
    first: [
      { name: 'Sir Fakhar', subject: 'Physics' },
      { name: 'Sir Ali', subject: 'Chemistry' },
      { name: 'Sir Naeem', subject: 'Mathematics' },
      { name: 'Sir Shazoor', subject: 'Biology' },
      { name: 'Sir Adnan', subject: 'English' }
    ],
    second: [
      { name: 'Sir Hassan', subject: 'Physics' },
      { name: 'Sir Hussain', subject: 'Chemistry' },
      { name: 'Dobey Sir', subject: 'Mathematics' },
      { name: 'Rathi Sir', subject: 'Biology' },
      { name: 'Sir Muddarab', subject: 'English' },
      { name: 'Sir Nobita', subject: 'Computer Science' }
    ]
  },
  activities: ['Sports Gala', 'Northern Area Trips', 'Qawali Night']
};

const APOLOGY_UR = 'معذرت، ہم اس سوال کا جواب نہیں دے سکتے۔';

function listTeachers(arr) {
  return arr.map(t => `${t.name} (${t.subject})`).join(', ');
}

function buildSystemPrompt() {
  return `You are the voice assistant of ${school.name}, a school in ${school.city}, Pakistan. You answer questions from students and parents.

VERIFIED FACTS (use only these):
- First year fees (PGC): ${school.fees.first} rupees.
- Second year fees (PGC): ${school.fees.second} rupees.
- First year teachers: ${listTeachers(school.teachers.first)}.
- Second year teachers: ${listTeachers(school.teachers.second)}.
- Subjects offered: ${school.subjects.map(x => x.name).join(', ')}.
- Extra-curricular activities: ${school.activities.join(', ')}.

RULES:
1. Decide if the question is related to this school: fees, teachers, subjects (and which teacher teaches which subject), years/classes, extra-curricular activities, or a greeting/thanks. If yes, related=true. Anything else (general knowledge, news, coding help, weather, jokes, politics, etc.) is related=false.
2. If related but the answer is not in the facts (for example timings, admission dates, address), say politely that they should contact the school office. Never invent facts.
3. Reply in the same language the user used. If the user spoke Urdu or Roman Urdu, answer in Urdu script. If English, answer in English.
4. Keep the answer to 1-3 short sentences, natural to be spoken aloud. No markdown, no emojis, no lists. Write amounts in words (for example "fifty thousand rupees" or "پچاس ہزار روپے").
5. Output ONLY valid JSON: {"related": true|false, "answer": "..."}. If related is false, answer must be an empty string.`;
}

module.exports = { school, APOLOGY_UR, buildSystemPrompt };
