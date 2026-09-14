'use client';
export default function BuildingError({ reset }: { reset: () => void }) {
  return <main id="main"><h1>Building records are unavailable</h1><p>The building index did not answer. Please try again.</p><button className="button" onClick={reset}>Try again</button> <a href="/map">Return to the map</a></main>;
}
