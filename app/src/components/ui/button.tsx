import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center font-bold whitespace-nowrap transition-colors outline-none select-none disabled:pointer-events-none disabled:opacity-[0.45] [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "rounded-full bg-[#ffcb05] text-black hover:bg-white",
        outline:
          "rounded-full border-2 border-[#ffcb05] bg-transparent text-[#ffcb05] hover:bg-[#ffcb05] hover:text-black",
        secondary: "rounded-full bg-white text-black hover:bg-[#ffcb05]",
        ghost: "rounded-full bg-transparent text-[#f5f5f5] hover:text-[#ffcb05]",
        destructive: "rounded-full bg-[#ee1515] text-white hover:bg-[#ff4d4d]",
        link: "bg-transparent text-[#ffcb05] underline underline-offset-4",
      },
      size: {
        default: "h-10 gap-1.5 px-4 text-sm",
        xs: "h-7 gap-1 px-2 text-xs",
        sm: "h-8 gap-1 px-3 text-xs",
        lg: "h-12 gap-1.5 px-6 text-base",
        icon: "size-10",
        "icon-xs": "size-6",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
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
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
