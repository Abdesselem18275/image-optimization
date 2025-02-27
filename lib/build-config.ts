export interface BuildConfig {
  readonly stage: "staging" | "prod";
  readonly optimizedImageExpDur: number
  readonly optimizedCacheTtl: string
  readonly awsAccountId: number
  readonly awsProfileRegion: string
  readonly storeTransformedImages: boolean
  readonly keyGroupId: string
  readonly baseHost: string

}
export class BuildConfig {
  constructor(arg: Partial<BuildConfig>) {
    Object.assign(this, {
      ...arg,
      optimizedImageExpDur: arg.optimizedImageExpDur ?? 90,
      optimizedCacheTtl: arg.optimizedCacheTtl ?? 'max-age=31622400',
      awsAccountId: arg.awsAccountId ?? 239912451711,
      storeTransformedImages: arg.storeTransformedImages ?? true
    })
  }

}
