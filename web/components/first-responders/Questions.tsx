import { AiMark, Button } from '@/components/ui';
import { AskPending } from '@/components/ask/AskPending';
import styles from './responders.module.css';

const groups = [
  {
    title: 'Deployments & assignments',
    questions: [
      'Where do the records place FDNY units on September 12, 2001?',
      'What records describe NYPD precinct or command assignments during the first week after September 11?',
      'What records identify staging areas, command posts, or reporting locations for responders?',
      'What records describe PAPD assignments at the World Trade Center?',
    ],
  },
  {
    title: 'Shifts & time at the site',
    questions: [
      'Are there unit logs, duty rosters, sign-in sheets, or other records of responder shifts?',
      'What records describe shift lengths and relief rotations for rescue and recovery crews?',
      'What records describe when units were reassigned or released from the site?',
      'What records describe access checkpoints and procedures for entering restricted work areas?',
    ],
  },
  {
    title: 'Air, dust & working conditions',
    questions: [
      'What air or dust sampling records are available near responder work areas in September 2001?',
      'What records describe conditions at responder staging and rest areas?',
      'What records describe smoke, fires, or dust during rescue and recovery work?',
      'What records compare sampling locations and times with areas where responders were working?',
    ],
  },
  {
    title: 'Protective equipment & instructions',
    questions: [
      'What instructions were FDNY and NYPD personnel given about respirators, and when?',
      'What records describe the distribution and availability of respirators and replacement filters?',
      'What records describe respirator fit testing or training for responders?',
      'What records describe decontamination, washing facilities, and cleaning of clothing or equipment?',
    ],
  },
  {
    title: 'Rescue, recovery & support work',
    questions: [
      'What records describe EMS and ambulance assignments, triage areas, or treatment stations?',
      'What records describe responder assignments at Fresh Kills during recovery operations?',
      'What records describe debris transport routes and the agencies assigned to support them?',
      'What records describe coordination among FDNY, NYPD, PAPD, EMS, and other response agencies?',
    ],
  },
  {
    title: 'Reconstructing what happened',
    questions: [
      'What situation reports or daily summaries describe rescue and recovery operations in September 2001?',
      'When were air and dust test results communicated to response agencies?',
      'What records describe changes to safety instructions as recovery work continued?',
      'Where do records give different dates or locations for the same response activity?',
    ],
  },
];

export function Questions() {
  return <>
    <form action="/ask" className={styles.form}>
      <h2><label htmlFor="responder-question">Start with your unit, date, or location</label></h2>
      <p id="responder-help">Write your own question below, or click a suggested question to run it immediately. Include an agency, unit or command, date or date range, and work site when you know them.</p>
      <textarea id="responder-question" name="q" required maxLength={1500} rows={3}
        aria-describedby="responder-help responder-privacy" defaultValue="Where do the records place FDNY units on September 12, 2001?" />
      <input type="hidden" name="mode" value="question" />
      <p id="responder-privacy" className="small muted">Ask about units and official activities. Leave out personal medical information, badge numbers, and other private details. Answers may receive shareable links.</p>
      <Button variant="primary" type="submit">Ask the records <AiMark /> →</Button>
      <AskPending />
    </form>
    <div className={styles.sectionHead}>
      <h2>Questions you might ask</h2>
      <p>Click a question to ask the records immediately. These are research starting points, not a list of records confirmed to be in the collection.</p>
    </div>
    <div className={styles.grid}>
      {groups.map(group => <section className={styles.group} key={group.title}>
        <h3>{group.title}</h3>
        <ul>{group.questions.map(text => <li key={text}>
          <a href={`/ask?q=${encodeURIComponent(text)}&mode=question`} className={styles.question}>{text} <AiMark /><span aria-hidden="true"> ↗</span></a>
        </li>)}</ul>
      </section>)}
    </div>
  </>;
}
