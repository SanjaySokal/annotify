import { getOrCreateParamRegistry } from './metadata.js';
import type { ParameterDecorator } from './types.js';

// In legacy mode, parameter decorators receive `(target, propertyKey, parameterIndex)`.
// For instance methods, `target` is the class prototype. Method decorators receive the
// same prototype as `target` plus the propertyKey. So we key the side-channel by the
// prototype object and store per-method arrays indexed by parameter position.

export function RequestParam(name?: string, defaultValue?: string): ParameterDecorator;
export function RequestParam(opts: { name?: string; defaultValue?: string }): ParameterDecorator;
export function RequestParam(
  a?: string | { name?: string; defaultValue?: string },
  b?: string,
): ParameterDecorator {
  let pname: string | undefined;
  let pdefault: string | undefined;
  if (typeof a === 'string') {
    pname = a;
    pdefault = b;
  } else if (a && typeof a === 'object') {
    pname = a.name;
    pdefault = a.defaultValue;
  }
  return (target, propertyKey, parameterIndex) => {
    const reg = getOrCreateParamRegistry(target);
    const key = String(propertyKey);
    const list = (reg[key] ??= []);
    list[parameterIndex] = { kind: 'param', name: pname, defaultValue: pdefault };
  };
}

export function PathVariable(name?: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const reg = getOrCreateParamRegistry(target);
    const key = String(propertyKey);
    const list = (reg[key] ??= []);
    list[parameterIndex] = { kind: 'path', name };
  };
}

export function RequestBody(): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const reg = getOrCreateParamRegistry(target);
    const key = String(propertyKey);
    const list = (reg[key] ??= []);
    list[parameterIndex] = { kind: 'body' };
  };
}

export function RequestHeader(name?: string): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const reg = getOrCreateParamRegistry(target);
    const key = String(propertyKey);
    const list = (reg[key] ??= []);
    list[parameterIndex] = { kind: 'header', name };
  };
}