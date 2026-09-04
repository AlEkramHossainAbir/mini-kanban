/**
 * What a user looks like once it leaves this module — never the
 * `passwordHash` column. Used for register/login/refresh/me responses and
 * for the shape `req.user` carries after JwtStrategy.validate.
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
}
