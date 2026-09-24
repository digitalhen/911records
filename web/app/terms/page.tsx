import Link from 'next/link';
import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';

export async function generateMetadata() {
  return pageMetadata('Terms of Service', 'Terms for using 911records.org and its connected research tools, operated by Cleartext Labs.', '/terms');
}

export default function Terms() {
  return (
    <PageShell prose>
      <h1>Terms of Service</h1>
      <p className="subtitle">Last updated September 15, 2026 · Cleartext Labs</p>

      <section>
        <h2>Using this service</h2>
        <p>These terms apply to 911records.org and its connected research tools, including the MCP service. Cleartext Labs operates this independent project. It is not affiliated with or endorsed by the City of New York, the World Trade Center Health Program, or the September 11th Victim Compensation Fund.</p>
        <p>By using the service, you agree to these terms. If you do not agree, please stop using the service. Access is currently free and does not require an account. A third-party application used to connect to the service may have its own fees and terms.</p>
      </section>

      <section>
        <h2>Records and research results</h2>
        <p>The collection contains records released by the City of New York. It is not a complete record of the September 11 response. Documents may be added, removed, replaced, or redacted, and our copy may lag behind the City’s current release.</p>
        <p>OCR text, search results, maps, extracted dates and measurements, summaries, and AI-generated answers may contain errors or omissions. Verify important findings against the original page image and current official record before relying on, filing, or publishing them. A document mentioning a person, building, or substance does not by itself establish exposure, illness, liability, or wrongdoing.</p>
        <p>The service provides research assistance, not legal or medical advice. It does not determine eligibility for compensation or health benefits, submit claims, or create an attorney-client or clinical relationship.</p>
      </section>

      <section>
        <h2>Responsible use</h2>
        <p>You may search, read, cite, and analyze the available records, including through the MCP service, subject to applicable law and any rights in the underlying material. These terms do not grant rights in third-party records or restrict rights you otherwise have under law. Please include the source agency, Bates page identifier, and source link when sharing findings.</p>
        <p>Do not use the service to harass people, reconstruct redacted identities, expose sensitive personal information, bypass access restrictions or rate limits, disrupt the service, or misrepresent generated material as an official City finding. Automated research is welcome within the service’s technical limits.</p>
        <p>If you find personal information that appears to have been missed during redaction, use the <Link href="/personal-information">personal-information reporting page</Link>. Do not repost that information in a public issue or feedback message. We may restrict access that threatens privacy, security, or reliable operation.</p>
      </section>

      <section>
        <h2>Your information and connected applications</h2>
        <p>Our <Link href="/privacy">Privacy Policy</Link> explains how the website handles information. Do not include confidential information, Social Security numbers, medical records, or account credentials in searches, questions, or reports.</p>
        <p>When you use a connected AI application, that application sends your tool requests to our service and receives the returned records or metadata. Its provider handles your conversation and the returned information under its own terms and privacy policy. Connecting an application does not give this service access to your private compensation or medical accounts.</p>
        <p>Keep your own copies of saved research and exports. Browser storage can be cleared or become unavailable.</p>
      </section>

      <section>
        <h2>Availability and limitations</h2>
        <p>The service is provided as available. We do not promise uninterrupted access, complete or error-free results, permanent storage, or that it will meet a particular research or claim requirement. Features and technical limits may change, and access to records may be withdrawn to reflect removals or privacy concerns.</p>
        <p>To the extent permitted by applicable law, we provide the service without warranties of accuracy, completeness, availability, or fitness for a particular purpose. Nothing in these terms excludes rights or protections that cannot lawfully be excluded.</p>
      </section>

      <section>
        <h2>Changes and contact</h2>
        <p>We may update these terms as the service changes. Updates will appear on this page with a revised date and apply to use after publication.</p>
        <p>For questions about these terms or support, email <a href="mailto:support@cleartextlabs.com">support@cleartextlabs.com</a>. Please do not send sensitive personal documents.</p>
      </section>
    </PageShell>
  );
}
