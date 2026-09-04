import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // bcrypt silently truncates input beyond 72 bytes — cap here so that
  // isn't a surprise, and 8 is a floor, not real strength policy (out of
  // scope for the 4-day MVP, PLAN §8).
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
