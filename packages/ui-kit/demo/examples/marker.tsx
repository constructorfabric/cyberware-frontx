// Marker's shimmer example below depends on the `shimmer` utility class —
// side-effect-imported here rather than added to demo/main.tsx, so this
// example carries its own dependency instead of assuming a shell change.
import '@gears-frontx/ui-kit/utilities.css';

import { Marker, MarkerContent, MarkerIcon, Spinner } from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

export default function MarkerExample() {
  return (
    <>
      <Section title="With icon">
        <Marker>
          <MarkerIcon>
            <DemoIcon />
          </MarkerIcon>
          <MarkerContent>Explored 4 files</MarkerContent>
        </Marker>
      </Section>

      <Section title="Status">
        <Marker role="status">
          <MarkerIcon>
            <Spinner />
          </MarkerIcon>
          <MarkerContent>Compacting conversation</MarkerContent>
        </Marker>
      </Section>

      <Section title="Shimmer">
        <Marker role="status">
          <MarkerContent className="shimmer">Thinking…</MarkerContent>
        </Marker>
      </Section>

      <Section title="Separator">
        <Marker variant="separator">
          <MarkerContent>Today</MarkerContent>
        </Marker>
      </Section>

      <Section title="Border">
        <Marker variant="border">
          <MarkerIcon>
            <DemoIcon />
          </MarkerIcon>
          <MarkerContent>Opened implementation notes</MarkerContent>
        </Marker>
      </Section>

      <Section title="Link or button">
        <Marker render={<a href="#pull-request" onClick={(event) => event.preventDefault()} />}>
          <MarkerContent>View the pull request</MarkerContent>
        </Marker>
      </Section>
    </>
  );
}
