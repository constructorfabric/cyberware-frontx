import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@gears-frontx/ui-kit';

import { DemoIcon, Section } from '../shared';

export default function NavigationMenuExample() {
  return (
    <>
      <Section title="Basic">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Products</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(10rem, 1fr))',
                    gap: 'var(--space-1)',
                    margin: 0,
                    padding: 'var(--space-2)',
                    listStyle: 'none',
                  }}
                >
                  <li>
                    <NavigationMenuLink href="#analytics">Analytics</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#reporting">Reporting</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#automation">Automation</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#integrations">Integrations</NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
              <NavigationMenuIndicator />
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Solutions</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul style={{ margin: 0, padding: 'var(--space-2)', listStyle: 'none' }}>
                  <li>
                    <NavigationMenuLink href="#startups">For startups</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#enterprises">For enterprises</NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
              <NavigationMenuIndicator />
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink className={navigationMenuTriggerStyle()} href="#pricing">
                Pricing
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Section>

      <Section title="With icon">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>
                <DemoIcon />
                Docs
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul style={{ margin: 0, padding: 'var(--space-2)', listStyle: 'none' }}>
                  <li>
                    <NavigationMenuLink href="#guides">Guides</NavigationMenuLink>
                  </li>
                  <li>
                    <NavigationMenuLink href="#api">API reference</NavigationMenuLink>
                  </li>
                </ul>
              </NavigationMenuContent>
              <NavigationMenuIndicator />
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Section>

      <Section title="Active link">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuLink className={navigationMenuTriggerStyle()} href="#overview" active>
                Overview
              </NavigationMenuLink>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink className={navigationMenuTriggerStyle()} href="#billing">
                Billing
              </NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Section>
    </>
  );
}
