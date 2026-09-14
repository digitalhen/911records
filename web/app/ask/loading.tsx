import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AiMark } from '@/components/ui';

/**
 * Streamed immediately while /ask?q=… plans, retrieves and writes a cited answer (about 20 s;
 * the finished page then redirects to its permanent /a/<id> URL). Without this the browser sat
 * on the previous page with only the tab spinner moving (2026-09-14, founder). Animated grey
 * placeholders stand in for the answer's real regions: question, tabs, sentences, source rail.
 */
export default function AskLoading() {
  return (
    <>
      <Header active="/ask" />
      <main id="main" aria-busy="true">
        <p className="small muted" role="status">
          Reading the records <AiMark /> — a cited answer usually takes about 20 seconds. Every sentence will carry
          the page it came from.
        </p>
        <div className="skeleton-page" aria-hidden="true">
          <div className="sk sk-input" />
          <div className="sk-row"><div className="sk sk-tab" /><div className="sk sk-tab" /></div>
          <div className="sk-layout">
            <div>
              <div className="sk sk-eyebrow" />
              <div className="sk sk-title" />
              <div className="sk" style={{ width: '96%' }} />
              <div className="sk" style={{ width: '88%' }} />
              <div className="sk" style={{ width: '92%' }} />
              <div className="sk" style={{ width: '60%' }} />
              <div className="sk sk-gap" />
              <div className="sk" style={{ width: '90%' }} />
              <div className="sk" style={{ width: '74%' }} />
              <div className="sk sk-gap" />
              <div className="sk sk-eyebrow" />
              <div className="sk" style={{ width: '70%' }} />
              <div className="sk" style={{ width: '64%' }} />
            </div>
            <aside>
              <div className="sk sk-eyebrow" />
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="sk-source" key={i}>
                  <div className="sk" style={{ width: '55%' }} />
                  <div className="sk" style={{ width: '80%' }} />
                </div>
              ))}
            </aside>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
