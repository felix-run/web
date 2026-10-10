import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from './lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * shadcn/ui's Sidebar (Radix flavour), adapted in three places for an app whose
 * shell already owns this state.
 *
 * 1. **Controlled, both halves.** `open` (inline: expanded or icons) and
 *    `openMobile` (the drawer) are props, and `mobile` says which one is on
 *    screen. Upstream reads its own media query, writes a cookie and binds
 *    `Mod+B`; here the breakpoint, persistence and the key all belong to the
 *    host, which already decided them and has reasons for each (Ctrl+B opens a
 *    Firefox sidebar).
 * 2. **In the flow, not fixed.** Upstream pins the panel to the viewport with a
 *    spacer beside it. Here the panel is an ordinary flex child whose width
 *    animates, beside an inset that holds the host's header — so the host's
 *    layout, not `position: fixed`, decides how tall it is.
 * 3. **Icon collapse only.** The one mode the host uses; `offcanvas` and the
 *    floating/inset variants are gone rather than carried untested.
 */

const SIDEBAR_WIDTH = '17rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_WIDTH_ICON = '3rem';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

function SidebarProvider({
  open,
  onOpenChange,
  openMobile,
  onOpenMobileChange,
  mobile,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  openMobile: boolean;
  onOpenMobileChange: (open: boolean) => void;
  mobile: boolean;
}) {
  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state: open ? 'expanded' : 'collapsed',
      open,
      setOpen: onOpenChange,
      openMobile,
      setOpenMobile: onOpenMobileChange,
      isMobile: mobile,
      toggleSidebar: () => (mobile ? onOpenMobileChange(!openMobile) : onOpenChange(!open)),
    }),
    [open, onOpenChange, openMobile, onOpenMobileChange, mobile],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            '--sidebar-width': SIDEBAR_WIDTH,
            '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-0 w-full flex-1', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({
  side = 'left',
  title = 'Sidebar',
  sheetProps,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right';
  /** The drawer's accessible name; a dialog needs one and the inline panel does not. */
  title?: string;
  /** Passed to the drawer's content, for host attributes such as a shortcut surface. */
  sheetProps?: React.ComponentProps<typeof SheetContent> & Record<`data-${string}`, string>;
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (isMobile) {
    const { className: sheetClassName, ...restSheet } = sheetProps ?? {};
    return (
      <Sheet open={openMobile} onOpenChange={setOpenMobile}>
        {/* `data-slot` stays the sheet's own: the host's keyboard layer finds an
            open drawer by it. */}
        <SheetContent
          data-sidebar="sidebar"
          data-mobile="true"
          showCloseButton={false}
          className={cn(
            'w-(--sidebar-width) max-w-full gap-0 bg-ground p-0 text-foreground sm:max-w-none',
            sheetClassName,
          )}
          style={{ '--sidebar-width': SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}
          side={side}
          {...restSheet}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>Threads, the workspace and the harness.</SheetDescription>
          </SheetHeader>
          <div className="flex h-full w-full flex-col">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="group peer flex shrink-0"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        data-sidebar="sidebar"
        data-slot="sidebar-inner"
        className={cn(
          'flex h-full w-(--sidebar-width) flex-col overflow-hidden bg-ground transition-[width] duration-200 ease-out motion-reduce:transition-none',
          'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-inset"
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col', className)}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<'hr'>) {
  return (
    <hr
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('mx-2 border-border/60', className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        // Sections keep their own height and the content scrolls; a shrinking
        // section would overflow into the one below it.
        'flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto *:shrink-0',
        'group-data-[collapsible=icon]:overflow-y-hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'div'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-hidden transition-[margin,opacity] duration-200 ease-out focus-visible:ring-[3px] focus-visible:ring-ring [&>svg]:size-3.5 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:-mt-7 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        'absolute top-2.5 right-3 flex aspect-square w-6 items-center justify-center rounded-md p-0 text-muted-foreground outline-hidden transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring coarse:w-9 [&>svg]:size-3.5 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-0.5', className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-lg px-2.5 text-left text-sm outline-hidden transition-[width,height,padding,background-color,color,box-shadow] duration-200 ease-out hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:shadow-sheet data-[active=true]:font-semibold data-[active=true]:text-foreground group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:p-2.5! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      size: {
        default: 'h-9 coarse:h-11',
        lg: 'h-auto min-h-12 py-1.5 group-data-[collapsible=icon]:min-h-0',
      },
    },
    defaultVariants: { size: 'default' },
  },
);

function SidebarMenuButton({
  asChild = false,
  isActive = false,
  size = 'default',
  tooltip,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  /** Shown beside the icon only while collapsed, where the label is not. */
  tooltip?: string;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const Comp = asChild ? Slot.Root : 'button';
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={cn(sidebarMenuButtonVariants({ size }), className)}
      {...props}
    />
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right" align="center" hidden={state !== 'collapsed' || isMobile}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & { asChild?: boolean; showOnHover?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        'absolute top-1 right-1 flex aspect-square w-6 items-center justify-center rounded-md p-0 text-muted-foreground outline-hidden transition-[color,opacity] hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring coarse:w-9 [&>svg]:size-3.5 [&>svg]:shrink-0',
        'group-data-[collapsible=icon]:hidden',
        // Hover reveals are gated on a pointer that can hover, never on a width:
        // on a touch screen the action is simply always there.
        showOnHover &&
          '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/menu-item:opacity-100 [@media(hover:hover)]:group-hover/menu-item:opacity-100 data-[state=open]:opacity-100!',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'pointer-events-none absolute top-1.5 right-2 flex h-5 items-center text-xs font-medium tabular-nums select-none',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  useSidebar,
};
