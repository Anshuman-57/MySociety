import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  api,
  refreshToken,
  saveTokens,
  toast,
  upload,
  useData,
  useWrite,
  type Tokens,
} from "./api";
import type { Me } from "./types";
import {
  Action,
  Button,
  Card,
  Field,
  Fields,
  Form,
  Heading,
  List,
  formatDate,
  values,
} from "./ui";

import { PhoneInput, phoneSchema } from "./phone";
type LoginTokens = Tokens & {
  user: { id: string };
  workspace: { id: string; home: string };
};
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="23"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M3 21V8l9-5 9 5v13M7 21V10h10v11M12 11v10M3 21h18" />
        </svg>
      </span>
      MySociety
    </span>
  );
}
export function Login({ signup = false }: { signup?: boolean }) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [sent, setSent] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [role, setRole] = useState("AUTO");
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{
    phone: string;
    code: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
  }>();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  function start(tokens: LoginTokens) {
    cache.clear();
    sessionStorage.removeItem("signupToken");
    localStorage.setItem("context:" + tokens.user.id, tokens.workspace.id);
    saveTokens(tokens);
    navigate(tokens.workspace.home, { replace: true });
  }
  async function send(phone: string) {
    const { resendAfterSeconds } = await api<{ resendAfterSeconds: number }>(
      "/auth/otp/request",
      "POST",
      { phone },
      true,
    );
    setSent(phone);
    setNow(Date.now());
    setResendAt(Date.now() + resendAfterSeconds * 1000);
  }
  return (
    <div className="login">
      <div className="w-full max-w-[440px] stack">
        <Brand />
        <Card>
          <Heading
            title={signup ? "Complete your profile" : "Sign in"}
            note={
              signup
                ? "Enter your name and date of birth once to open your workspace."
                : sent
                  ? "Enter the six-digit code sent to " + sent + "."
                  : "Use your mobile number to get a one-time code."
            }
          />
          <form
            className="stack"
            onSubmit={handleSubmit(async (fields) => {
              setError("");
              try {
                if (signup) {
                  const signupToken = sessionStorage.getItem("signupToken");
                  if (!signupToken)
                    throw new Error(
                      "Verify your phone before creating an account.",
                    );
                  return start(
                    await api<LoginTokens>(
                      "/auth/signup",
                      "POST",
                      {
                        signupToken,
                        firstName: fields.firstName,
                        lastName: fields.lastName || undefined,
                        dateOfBirth: fields.dateOfBirth,
                      },
                      true,
                    ),
                  );
                }
                if (!sent) {
                  const phone = phoneSchema.safeParse(fields.phone);
                  if (!phone.success)
                    throw new Error(phone.error.issues[0].message);
                  return await send(phone.data);
                }
                const result = await api<
                  LoginTokens & { isNewUser: boolean; signupToken: string }
                >(
                  "/auth/otp/verify",
                  "POST",
                  { phone: sent, code: fields.code, role },
                  true,
                );
                if (result.isNewUser) {
                  sessionStorage.setItem("signupToken", result.signupToken);
                  navigate("/signup");
                } else start(result);
              } catch (error) {
                setError((error as Error).message);
              }
            })}
          >
            {!signup && (
              <Field label="Sign in as">
                <select
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value);
                    setError("");
                  }}
                >
                  <option value="AUTO">My primary role</option>
                  <option value="VISITOR">Visitor</option>
                  <option value="ADMIN">Platform Admin</option>
                  <option value="SECRETARY">Secretary</option>
                  <option value="GUARD">Guard</option>
                  <option value="RESIDENT">Resident</option>
                </select>
              </Field>
            )}
            {signup ? (
              <>
                <Field label="First name">
                  <input
                    {...register("firstName")}
                    autoComplete="given-name"
                    required
                  />
                </Field>
                <Field label="Last name (optional)">
                  <input {...register("lastName")} autoComplete="family-name" />
                </Field>
                <Field label="Date of birth">
                  <input type="date" {...register("dateOfBirth")} required />
                </Field>
              </>
            ) : sent ? (
              <Field label="One-time code">
                <input
                  {...register("code")}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  required
                />
              </Field>
            ) : (
              <Field label="Mobile number (+91)">
                <PhoneInput {...register("phone")} required />
              </Field>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting}>
              {signup ? "Continue to workspace" : sent ? "Verify code" : "Send code"}
            </Button>
            {!signup && sent && (
              <div className="actions">
                <Button
                  secondary
                  disabled={remaining > 0}
                  onClick={() =>
                    void send(sent).catch((error) => setError(error.message))
                  }
                >
                  {remaining ? `Resend in ${remaining}s` : "Resend code"}
                </Button>
                <Button
                  secondary
                  onClick={() => {
                    setSent("");
                    setError("");
                  }}
                >
                  Change number
                </Button>
              </div>
            )}
            {signup && (
              <Link className="text-sm underline" to="/login">
                Back to sign in
              </Link>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
export function useLogout() {
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    logout: async (all = false) => {
      setBusy(true);
      try {
        await api(
          all ? "/auth/logout-all" : "/auth/logout",
          "POST",
          all ? undefined : { refreshToken: refreshToken() },
        );
        cache.clear();
        saveTokens(null);
        navigate("/login", { replace: true });
      } catch (error) {
        toast((error as Error).message, true);
      } finally {
        setBusy(false);
      }
    },
  };
}
export function Profile({ me }: { me: Me }) {
  const write = useWrite();
  const { logout, busy } = useLogout();
  const [phone, setPhone] = useState("");
  const user = me.user;
  return (
    <>
      <Heading title="Profile & sessions" note={user.phone} />
      <div className="stack">
        <Card title="Profile">
          <Form
            label="Save profile"
            submit={async (event) => {
              const file = new FormData(event.currentTarget).get(
                "photo",
              ) as File;
              const fields = values(event);
              const profilePhotoUrl = file.size
                ? await upload(file, "PROFILE")
                : undefined;
              await write.mutateAsync({
                path: "/me",
                method: "PATCH",
                body: { ...fields, profilePhotoUrl },
              });
            }}
          >
            {user.profilePhotoUrl && (
              <img
                src={user.profilePhotoUrl}
                alt=""
                className="h-16 w-16 rounded-full object-cover"
              />
            )}
            <Fields
              fields={[
                ["firstName", "First name"],
                ["lastName", "Last name (optional)", "optional"],
              ]}
              initial={user}
            />
            <Field label="Profile photo">
              <input
                name="photo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
              />
            </Field>
          </Form>
        </Card>
        <Card title="Change phone number">
          <Form
            key={phone || "request"}
            label={phone ? "Verify new number" : "Send code"}
            submit={async (event) => {
              const fields = values(event);
              if (phone) {
                await write.mutateAsync({
                  path: "/me/phone/verify",
                  body: { newPhone: phone, code: fields.code },
                });
                setPhone("");
              } else {
                const newPhone = phoneSchema.parse(fields.newPhone);
                await write.mutateAsync({
                  path: "/me/phone/otp",
                  body: { newPhone },
                });
                setPhone(newPhone);
              }
            }}
          >
            {phone ? (
              <>
                <p>Code sent to {phone}</p>
                <Fields fields={[["code", "One-time code"]]} />
                <Button secondary onClick={() => setPhone("")}>
                  Use a different number
                </Button>
              </>
            ) : (
              <Fields
                fields={[["newPhone", "New mobile number (+91)", "tel"]]}
              />
            )}
          </Form>
        </Card>
        <Card title="Active sessions">
          <List<{
            id: string;
            deviceName: string | null;
            lastUsedAt: string;
            isCurrent: boolean;
          }>
            path="/auth/sessions"
            render={(session) => (
              <div className="row" key={session.id}>
                <div className="min-w-0 break-words">
                  <strong>
                    {session.isCurrent
                      ? "This device"
                      : session.deviceName || "Other device"}
                  </strong>
                  <p className="muted text-sm">
                    Last used {formatDate(session.lastUsedAt)}
                  </p>
                </div>
              </div>
            )}
          />
          <div className="actions">
            <Button secondary disabled={busy} onClick={() => void logout()}>
              Log out this device
            </Button>
            <Button secondary disabled={busy} onClick={() => void logout(true)}>
              Log out all devices
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}
export interface Notice {
  id: string;
  title: string;
  body: string;
  type: string;
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}
export function Notifications({ open }: { open: (notice: Notice) => void }) {
  const [unread, setUnread] = useState(false);
  const write = useWrite();
  return (
    <>
      <Heading title="Notifications">
        <Action path="/notifications/read-all" secondary>
          Mark all read
        </Action>
      </Heading>
      <Card>
        <label className="actions">
          <input
            type="checkbox"
            checked={unread}
            onChange={(event) => setUnread(event.target.checked)}
          />{" "}
          Unread only
        </label>
        <List<Notice>
          path={"/notifications" + (unread ? "?unread=true" : "")}
          render={(notice) => (
            <div className="row" key={notice.id}>
              <div>
                <strong>{notice.title}</strong>
                {notice.body !== notice.title && (
                  <p className="muted">{notice.body}</p>
                )}
                <p className="muted text-sm">{formatDate(notice.createdAt)}</p>
              </div>
              <Button
                secondary
                disabled={write.isPending}
                onClick={async () => {
                  if (!notice.readAt)
                    try {
                      await write.mutateAsync({
                        path: "/notifications/" + notice.id + "/read",
                      });
                    } catch {
                      return;
                    }
                  open(notice);
                }}
              >
                {notice.readAt ? "Open" : "Read & open"}
              </Button>
            </div>
          )}
        />
      </Card>
    </>
  );
}
export const useMe = (loggedIn: boolean) => useData<Me>("/me", loggedIn);
