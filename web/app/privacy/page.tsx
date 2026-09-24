import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';

export async function generateMetadata() {
  return pageMetadata('Privacy', 'What 911records.org and its ChatGPT app collect, why, who receives it, how long it is kept, and your choices.', '/privacy');
}

export default function Privacy() {
  return (
    <PageShell prose>
      <h1>Privacy</h1>
      <p className="subtitle">Last updated September 24, 2026 · Cleartext Labs</p>

      <section>
        <h2>Summary</h2>
        <p>911records.org and the 9/11 Records app for ChatGPT and other AI assistants (together, “the service”) are operated by Cleartext Labs. The service has no accounts or sign-ups and never asks for your name, email address, phone number or payment details. The records themselves are public documents released by the City of New York.</p>
        <p>This policy covers the website at 911records.org (and its former address 911records.nyc) and the connected-app endpoint at 911records.org/mcp. We do not sell personal information and do not use it for advertising profiles.</p>
      </section>

      <section id="chatgpt">
        <h2>ChatGPT and other AI assistant apps</h2>
        <p>When you use 9/11 Records inside ChatGPT or another assistant that supports the Model Context Protocol, the assistant decides when to call our tools and sends us only the tool inputs below. We do not receive your ChatGPT account details, name, email address, conversation history, uploaded files or location from the assistant.</p>
        <h3>What each tool receives and returns</h3>
        <ul>
          <li><strong>search_records</strong> receives a search query written by the assistant from your request, plus optional filters (agency, volume, box, folder, address, substance, laboratory, year) and a result page. It returns matching page citations, machine-generated titles and links.</li>
          <li><strong>get_document</strong> receives a document identifier and page, and optionally up to three selected source pages with short explanations and quotations written by the assistant for the evidence panel. It returns document details, page text, scan links and citations.</li>
          <li><strong>get_page</strong> receives a document identifier, page number and text position. It returns that page’s text, Bates number and scan link.</li>
          <li><strong>browse_collection</strong> receives optional catalog filters and a position in the list. It returns catalog entries.</li>
          <li><strong>get_changes</strong> receives an optional date and position. It returns catalog change dates, identifiers and change types.</li>
        </ul>
        <p>Every tool is read-only: none of them saves, publishes or shares what you send. Tool outputs contain only information from the public City records and our catalog, never information about you or other users.</p>
        <h3>How tool inputs are used</h3>
        <ul>
          <li><strong>Purpose.</strong> Inputs are used only to answer that request: to search the records, check that a document is still available, verify that any quotation matches the source page, and return the result. They are not used for analytics, advertising, profiling or training AI models.</li>
          <li><strong>Where they go.</strong> Search queries are converted into a search representation by an embedding model that runs on our own servers, and searched against our own index. Tool inputs are not sent to Anthropic, Google, advertisers or any other AI provider.</li>
          <li><strong>Retention.</strong> We do not store tool inputs or outputs in a database or log them. They are held in memory only while the request is processed and discarded when the response is sent. To prevent abuse, the requesting network address is kept in memory for about one minute to enforce a rate limit, then discarded.</li>
          <li><strong>The assistant provider.</strong> The assistant you use (for example, OpenAI for ChatGPT) receives our tool results and keeps them as part of your conversation under its own privacy policy and your settings there. See <a href="https://openai.com/policies/privacy-policy/">OpenAI’s privacy policy</a> to manage or delete ChatGPT conversations.</li>
          <li><strong>The evidence panel.</strong> The document panel shown inside the assistant loads page scans and images from 911records.org. Those requests reach our servers and Cloudflare with standard connection information, described below. The panel contains no analytics, advertising or cookies of its own.</li>
        </ul>
        <p>Please do not include names, medical details or other personal information in requests to the app; it is not needed to search the records.</p>
      </section>

      <section>
        <h2>What the website collects</h2>
        <ul>
          <li><strong>Connection information.</strong> Like most websites, the servers and network that deliver these pages process your IP address, browser type, the page requested and the time in order to deliver pages, stop abuse and keep the service secure. The site is served through Cloudflare, which processes this information as part of delivering and protecting the site.</li>
          <li><strong>Usage analytics.</strong> We use Google Analytics (GA4) to see how the site is used: pages viewed, referring site, device type and an approximate location derived from IP address. GA4 does not log or store full IP addresses, and analytics data is not linked to a name or email address, since this site asks for neither.</li>
          <li><strong>Reading counts.</strong> Opening a document adds one to that document’s view count for the day, used for “What others are reading”. The count stores no IP address, cookie or identifier.</li>
          <li><strong>Ask questions.</strong> When you use Ask on the website, your question and selected record excerpts are sent to our answer provider, Anthropic, to prepare a cited answer. The question and answer are stored with a shareable permalink. We do not store your IP address with them.</li>
          <li><strong>Reports and submissions.</strong> The personal-information report form stores the Bates page, location and note you enter, with a receipt reference and time. The Contradictions form stores the submission type, source references, note, receipt reference, time and review status. Neither asks for your name or email address, and submissions are not published automatically.</li>
          <li><strong>Short links.</strong> When you create a short link, we store the destination page address, including its search terms, so the link continues to work. Anyone with the link can open that destination.</li>
          <li><strong>Download verification.</strong> Bulk downloads use Cloudflare Turnstile to help prevent automated abuse; Cloudflare processes browser and connection information to perform this check. After a successful check we set a signed, essential cookie that authorizes downloads for 12 hours. It contains an expiry time and a random identifier, not your name or email address, and is not used for advertising.</li>
          <li><strong>Your browser.</strong> Case-folder saves and notes stay in your own browser and are not sent to us. A link to the case-folder page does not share them.</li>
        </ul>
      </section>

      <section>
        <h2>Why we use it</h2>
        <p>We use this information to provide the search, reading, Ask and download features you request; to review reports of missed redactions and suggested corrections; to understand which parts of the service are useful; to cover running costs through advertising on some website pages; and to protect the service against abuse and keep it secure. We do not sell personal information.</p>
      </section>

      <section>
        <h2>Who receives it</h2>
        <ul>
          <li><strong>Cloudflare</strong> delivers and protects the website and app endpoint, and runs download verification. <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>.</li>
          <li><strong>Google</strong> provides analytics on the website and advertising on some website pages, described below. <a href="https://policies.google.com/privacy">Google’s privacy policy</a>.</li>
          <li><strong>Anthropic</strong> receives Ask questions from the website with record excerpts to prepare answers. It does not receive anything from the ChatGPT app. <a href="https://www.anthropic.com/legal/privacy">Anthropic’s privacy policy</a>.</li>
          <li><strong>The AI assistant you use</strong>, such as OpenAI’s ChatGPT, receives the results of the tools it calls.</li>
          <li><strong>Anyone with a link</strong> can open a short link or an Ask answer permalink.</li>
        </ul>
        <p>The service runs on servers operated by Cleartext Labs. We may disclose information if required by law. We do not otherwise share it.</p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <ul>
          <li><strong>ChatGPT and assistant app requests:</strong> not stored; discarded when the response is sent. Rate-limit addresses: about one minute, in memory only.</li>
          <li><strong>Server and network logs:</strong> kept only as long as needed to operate and secure the service, not as a long-term archive. Cloudflare keeps its logs as described in its policy.</li>
          <li><strong>Google Analytics:</strong> event data is deleted automatically after the retention period set in Google Analytics, which is no longer than 14 months.</li>
          <li><strong>Ask questions and answers, and short links:</strong> kept so their permalinks keep working, until deleted on request or when the feature is retired.</li>
          <li><strong>Reports and Contradictions submissions:</strong> kept until review is complete and the submission is removed, or until deleted on request.</li>
          <li><strong>Download cookie:</strong> expires after 12 hours.</li>
        </ul>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>You can use the website and the app without giving us your name, email address or any account.</li>
          <li>In ChatGPT, you can disconnect or stop using the 9/11 Records app at any time in ChatGPT’s settings, and delete conversations there.</li>
          <li>Opt out of Google Analytics with <a href="https://tools.google.com/dlpage/gaoptout">Google’s opt-out browser add-on</a>, or block scripts from googletagmanager.com and google-analytics.com in your browser.</li>
          <li>Turn off personalized ads in <a href="https://adssettings.google.com/">Google Ads Settings</a> or at <a href="https://www.aboutads.info/choices/">aboutads.info</a>.</li>
          <li>Clear case-folder saves and cookies at any time in your browser.</li>
          <li>To ask about, correct or delete an Ask answer, short link or submission, email <a href="mailto:henry@digitalhen.com">henry@digitalhen.com</a> with the permalink or receipt reference. Because we hold no accounts, we need that reference to find it. Depending on where you live, you may have further rights to access or delete personal information; contact us at the same address to use them.</li>
        </ul>
      </section>

      <section>
        <h2>Advertising</h2>
        <p>Some website pages show ads served by Google AdSense to help cover costs, when advertising is enabled. Google and its partners use cookies and similar technologies to show ads, limit how often you see them and measure their performance. Where you have allowed it, those ads may be based on your prior visits to this and other websites. See <a href="https://policies.google.com/technologies/partner-sites">how Google uses information from sites that show its ads</a>.</p>
        <p>If you are in the European Economic Area, the United Kingdom or Switzerland, you are asked for consent before personalized ads are shown, and you can change that choice at any time from the privacy link Google adds to the page.</p>
        <p>Ads appear below the main content on home, browse and change-history pages; never in documents, answers, policy pages or the ChatGPT app. We do not use the content of the City’s records or your reading history to target ads.</p>
      </section>

      <section>
        <h2>Personal information in the records</h2>
        <p>The documents are published by the City of New York. The City redacted personal information before release and says some may have been missed. We serve the records with the City’s redactions and do not yet run our own redaction pass. Read our <Link href="/personal-information">personal-information policy or report a missed redaction</Link>. You can also report to the City through its <a href="https://sept11documents.cityofnewyork.us/">official portal</a>.</p>
      </section>

      <section>
        <h2>Children</h2>
        <p>The service is intended for adults researching public records and is not directed to children under 13. We do not knowingly collect personal information from children.</p>
      </section>

      <section>
        <h2>Security</h2>
        <p>Connections to the service are encrypted with HTTPS. Stored submissions are accessible only to Cleartext Labs. No method of transmission or storage is completely secure, which is one reason we collect as little as possible.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>If this policy changes, we will update this page and the date at the top. For privacy questions or requests, email <a href="mailto:henry@digitalhen.com">henry@digitalhen.com</a>. Cleartext Labs is independent and not affiliated with the City of New York.</p>
      </section>
    </PageShell>
  );
}
