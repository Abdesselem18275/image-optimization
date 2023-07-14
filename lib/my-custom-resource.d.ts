import { Construct } from 'constructs';
export interface MyCustomResourceProps {
    Url: string;
}
export declare class MyCustomResource extends Construct {
    readonly hostname: string;
    constructor(scope: Construct, id: string, props: MyCustomResourceProps);
}
