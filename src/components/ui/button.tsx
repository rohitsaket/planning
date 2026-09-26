import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-[#FF6934] to-[#F95721] text-white shadow-[0_2px_8px_rgba(249,87,33,0.28)] hover:from-[#F85820] hover:to-[#E5450E] font-bold focus-visible:ring-2 focus-visible:ring-[#F9733E]/50 rounded-xl transition-all active:scale-[0.98]",
        cta:
          "bg-gradient-to-r from-[#FF6934] to-[#F95721] text-white shadow-[0_2px_8px_rgba(249,87,33,0.28)] hover:from-[#F85820] hover:to-[#E5450E] font-bold focus-visible:ring-2 focus-visible:ring-[#F9733E]/50 rounded-xl transition-all active:scale-[0.98]",
        brand:
          "bg-gradient-to-r from-[#FF6934] to-[#F95721] text-white shadow-[0_2px_8px_rgba(249,87,33,0.28)] hover:from-[#F85820] hover:to-[#E5450E] font-bold focus-visible:ring-2 focus-visible:ring-[#F9733E]/50 rounded-xl transition-all active:scale-[0.98]",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60 rounded-xl",
        outline:
          "border border-border/90 bg-card text-foreground shadow-2xs hover:bg-muted/80 hover:text-foreground dark:bg-card dark:border-border dark:hover:bg-muted rounded-xl font-semibold",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80 rounded-xl font-medium",
        ghost:
          "hover:bg-muted hover:text-foreground rounded-xl",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
