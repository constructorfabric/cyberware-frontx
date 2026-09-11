/**
 * Sidebar Component - Based on shadcn/ui sidebar
 * Simplified for desktop-only collapsible navigation
 */

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/app/lib/utils"

const Sidebar = (
  {
    ref,
    collapsed = false,
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & {
    collapsed?: boolean;
    ref?: React.Ref<HTMLElement>;
  }
) => {
  return (
    <aside
      ref={ref}
      data-state={collapsed ? "collapsed" : "expanded"}
      data-collapsible={collapsed ? "icon" : ""}
      className={cn(
        "group flex flex-col border-r border-mainMenu-border transition-[width] duration-200 ease-linear",
        "bg-mainMenu text-mainMenu-foreground",
        collapsed ? "w-14" : "w-64",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  )
}
Sidebar.displayName = "Sidebar"

const SidebarContent = (
  {
    ref,
    className,
    ...props
  }: React.ComponentProps<"div"> & {
    ref?: React.Ref<HTMLDivElement>;
  }
) => (<div
  ref={ref}
  data-sidebar="content"
  className={cn(
    "flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden p-2",
    className
  )}
  {...props}
/>)
SidebarContent.displayName = "SidebarContent"

const SidebarMenu = (
  {
    ref,
    className,
    ...props
  }: React.ComponentProps<"ul"> & {
    ref?: React.Ref<HTMLUListElement>;
  }
) => (<ul
  ref={ref}
  data-sidebar="menu"
  className={cn("flex w-full min-w-0 flex-col gap-1", className)}
  {...props}
/>)
SidebarMenu.displayName = "SidebarMenu"

const SidebarMenuItem = (
  {
    ref,
    className,
    ...props
  }: React.ComponentProps<"li"> & {
    ref?: React.Ref<HTMLLIElement>;
  }
) => (<li
  ref={ref}
  data-sidebar="menu-item"
  className={cn("group/menu-item relative", className)}
  {...props}
/>)
SidebarMenuItem.displayName = "SidebarMenuItem"

type SidebarMenuButtonVariant = "default" | "outline"
type SidebarMenuButtonSize = "default" | "sm" | "lg"

const SIDEBAR_MENU_BUTTON_BASE_CLASSES =
  "peer/menu-button flex w-full items-center gap-2 rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>span:last-child]:overflow-hidden [&>svg]:size-5 [&>svg]:shrink-0 text-mainMenu-foreground hover:bg-mainMenu-hover data-[active=true]:bg-mainMenu-selected data-[active=true]:text-white data-[active=true]:font-medium"

const SIDEBAR_MENU_BUTTON_VARIANT_CLASSES: Record<SidebarMenuButtonVariant, string> = {
  default: "",
  outline: "bg-background shadow-[0_0_0_1px_var(--border)] hover:bg-mainMenu-hover",
}

const SIDEBAR_MENU_BUTTON_SIZE_CLASSES: Record<SidebarMenuButtonSize, string> = {
  default: "h-10 text-sm",
  sm: "h-7 text-xs",
  lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0",
}

function sidebarMenuButtonVariants({
  variant = "default",
  size = "default",
}: {
  variant?: SidebarMenuButtonVariant
  size?: SidebarMenuButtonSize
}) {
  return cn(
    SIDEBAR_MENU_BUTTON_BASE_CLASSES,
    SIDEBAR_MENU_BUTTON_VARIANT_CLASSES[variant],
    SIDEBAR_MENU_BUTTON_SIZE_CLASSES[size]
  )
}

const SidebarMenuButton = (
  {
    ref,
    asChild = false,
    isActive = false,
    variant = "default",
    size = "default",
    tooltip,
    className,
    ...props
  }: React.ComponentPropsWithoutRef<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    variant?: SidebarMenuButtonVariant;
    size?: SidebarMenuButtonSize;
    tooltip?: string;
    ref?: React.Ref<HTMLButtonElement>;
  }
) => {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      ref={ref}
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      title={tooltip}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
SidebarMenuButton.displayName = "SidebarMenuButton"

const SidebarMenuIcon = (
  {
    ref,
    className,
    ...props
  }: React.ComponentProps<"span"> & {
    ref?: React.Ref<HTMLSpanElement>;
  }
) => (<span
  ref={ref}
  className={cn("size-5 min-w-[1.5rem] flex-shrink-0 [&>svg]:w-full [&>svg]:h-full", className)}
  {...props}
/>)
SidebarMenuIcon.displayName = "SidebarMenuIcon"

const SidebarMenuLabel = (
  {
    ref,
    className,
    ...props
  }: React.ComponentProps<"span"> & {
    ref?: React.Ref<HTMLSpanElement>;
  }
) => (<span
  ref={ref}
  className={cn(className)}
  {...props}
/>)
SidebarMenuLabel.displayName = "SidebarMenuLabel"

export interface SidebarHeaderProps extends React.ComponentProps<"div"> {
  logo?: React.ReactNode
  logoText?: React.ReactNode
  collapsed?: boolean
  onClick?: () => void
}

const SidebarHeader = (
  {
    ref,
    logo,
    logoText,
    collapsed = false,
    onClick,
    className,
    ...props
  }: SidebarHeaderProps & {
    ref?: React.Ref<HTMLDivElement>;
  }
) => {
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col h-16",
        className
      )}
      {...props}
    >
      <div className="flex items-center flex-1 px-2">
        <SidebarMenuButton onClick={onClick} tooltip={collapsed ? "Expand menu" : "Collapse menu"}>
          {logo && <SidebarMenuIcon>{logo}</SidebarMenuIcon>}
          {logoText && (
            <SidebarMenuLabel className="[&>svg]:h-5 [&>svg]:w-auto">
              {logoText}
            </SidebarMenuLabel>
          )}
        </SidebarMenuButton>
      </div>
      <div className="border-b border-mainMenu-border mx-4" />
    </div>
  )
}
SidebarHeader.displayName = "SidebarHeader"

export {
  Sidebar,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuLabel,
  SidebarMenuIcon,
  SidebarHeader,
}
