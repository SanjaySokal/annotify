// Custom decorator types for TypeScript legacy (experimental) decorators.
// We define these so we don't depend on TS's lib types (which require reflect-metadata
// imports and exact signatures that don't match our side-channel pattern).

export type ClassDecorator = (target: Function) => void;

export type MethodDecorator = (
  target: object,
  propertyKey: string | symbol,
  descriptor: PropertyDescriptor,
) => void;

export type ParameterDecorator = (
  target: object,
  propertyKey: string | symbol,
  parameterIndex: number,
) => void;