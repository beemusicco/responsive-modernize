const X = ({active}) => <div className={cn("grid grid-cols-3", {active: !!active})}>{children}</div>;
