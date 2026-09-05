import { IsOptional, IsString, MaxLength } from 'class-validator';

/** `?q=` for `GET :boardId/members/candidates` — a prefix/substring of the
 *  registered email (or name) the OWNER is typing into the invite field.
 *  Optional: an empty query still returns a short list rather than erroring,
 *  same as most autocomplete UIs. */
export class SearchMembersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
