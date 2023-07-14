export interface BuildConfig {
    readonly stage: string;
    readonly optimizedImageExpDur: number;
    readonly optimizedCacheTtl: string;
    readonly awsAccountId: number;
    readonly awsProfileRegion: string;
    readonly storeTransformedImages: boolean;
    readonly keyGroupId: string;
    readonly baseHost: string;
}
export declare class BuildConfig {
    constructor(arg: Partial<BuildConfig>);
}
