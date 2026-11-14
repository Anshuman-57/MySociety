import { forwardRef, type InputHTMLAttributes } from 'react';
import { z } from 'zod';

export const phoneSchema = z.string().regex(/^(?:\+91)?[0-9]{10}$/, 'Enter exactly 10 digits after +91')
  .transform(value => value.startsWith('+91') ? value : '+91' + value);
export const mobileDigits = (value: string) => value.replace(/^\+91/, '').replace(/[^0-9]/g, '').slice(0, 10);

export const PhoneInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PhoneInput(
  { onChange, value, defaultValue, ...props }, ref
) {
  return <div className="flex items-center gap-2"><span className="shrink-0" aria-hidden="true">+91</span>
    <input {...props} ref={ref} type="tel" inputMode="numeric" autoComplete="tel-national"
      placeholder="9876543210" minLength={10} maxLength={10} pattern="[0-9]{10}" title="Enter exactly 10 digits after +91"
      {...(value !== undefined ? { value: mobileDigits(String(value)) } : {})}
      {...(defaultValue !== undefined ? { defaultValue: mobileDigits(String(defaultValue)) } : {})}
      onChange={event => { event.currentTarget.value = mobileDigits(event.currentTarget.value); onChange?.(event); }}/>
  </div>;
});
