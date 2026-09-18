import type { ComponentProps, ReactNode } from "react";

import { Button } from "@Closer/ui/components/button";

type AsyncButtonProps = Omit<ComponentProps<typeof Button>, "children"> & {
  children: ReactNode;
  pending?: boolean;
  pendingText: ReactNode;
};

export function AsyncButton({
  children,
  pending = false,
  pendingText,
  disabled,
  ...props
}: AsyncButtonProps) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
